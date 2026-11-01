use anyhow::{Context, Result, anyhow, bail};
use regex::Regex;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::env;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const PACK_KINDS: [&str; 2] = ["behavior_packs", "resource_packs"];
const EXPECTED_MODULES: [(&str, &str); 2] = [
    ("@minecraft/server", "2.9.0"),
    ("@minecraft/server-ui", "2.1.0"),
];
const SAFE_NON_ASCII: &str = "§áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ";

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask lives below the repository root")
        .to_path_buf()
}

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("check") => check(),
        Some("stress") => stress(),
        Some("build") => build(args.any(|arg| arg == "--all")),
        Some("all") => {
            check()?;
            stress()?;
            build(true)
        }
        _ => bail!("usage: cargo xtask <check|stress|build [--all]|all>"),
    }
}

#[derive(Default)]
struct Findings {
    failures: Vec<String>,
    warnings: Vec<String>,
}

impl Findings {
    fn fail(&mut self, path: &Path, line: usize, message: impl AsRef<str>) {
        self.failures
            .push(format!("{}:{line}  {}", shown(path), message.as_ref()));
    }

    fn warn(&mut self, path: &Path, line: usize, message: impl AsRef<str>) {
        self.warnings
            .push(format!("{}:{line}  {}", shown(path), message.as_ref()));
    }
}

fn shown(path: &Path) -> String {
    path.strip_prefix(root())
        .unwrap_or(path)
        .display()
        .to_string()
}

fn files_with_extension(folder: &Path, extension: &str) -> Vec<PathBuf> {
    let mut files: Vec<_> = WalkDir::new(folder)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(walkdir::DirEntry::into_path)
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some(extension))
        .collect();
    files.sort();
    files
}

fn read(path: &Path) -> Result<String> {
    fs::read_to_string(path).with_context(|| format!("could not read {}", shown(path)))
}

fn release_version() -> Result<String> {
    let version = read(&root().join("VERSION"))?.trim().to_owned();
    let pattern = Regex::new(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$")?;
    if !pattern.is_match(&version) {
        bail!("VERSION is not a supported semantic version: {version}")
    }
    Ok(version)
}

fn core_version(version: &str) -> &str {
    version.split('-').next().unwrap_or(version)
}

fn json(path: &Path, findings: &mut Findings) -> Option<Value> {
    let text = match read(path) {
        Ok(text) => text,
        Err(error) => {
            findings.fail(path, 1, error.to_string());
            return None;
        }
    };
    match serde_json::from_str(&text) {
        Ok(value) => Some(value),
        Err(error) => {
            findings.fail(path, error.line(), format!("invalid JSON: {error}"));
            None
        }
    }
}

fn check_manifest(path: &Path, findings: &mut Findings) {
    let Some(data) = json(path, findings) else {
        return;
    };
    let header = data.get("header").and_then(Value::as_object);
    for field in ["name", "uuid", "version", "min_engine_version"] {
        if header.and_then(|value| value.get(field)).is_none() {
            findings.fail(path, 1, format!("header is missing '{field}'"));
        }
    }

    let mut uuids = Vec::new();
    if let Some(uuid) = header
        .and_then(|value| value.get("uuid"))
        .and_then(Value::as_str)
    {
        uuids.push(uuid.to_owned());
    }
    let mut kinds = HashSet::new();
    if let Some(modules) = data.get("modules").and_then(Value::as_array) {
        for module in modules {
            if let Some(uuid) = module.get("uuid").and_then(Value::as_str) {
                uuids.push(uuid.to_owned());
            }
            if let Some(kind) = module.get("type").and_then(Value::as_str) {
                kinds.insert(kind.to_owned());
                if kind == "script" && module.get("entry").is_none() {
                    findings.fail(path, 1, "script module has no 'entry'");
                }
            }
        }
    }
    let mut seen = HashSet::new();
    for uuid in uuids {
        if !seen.insert(uuid.clone()) {
            findings.fail(path, 1, format!("duplicate UUID: {uuid}"));
        }
    }
    if let Some(dependencies) = data.get("dependencies").and_then(Value::as_array) {
        for dependency in dependencies {
            let Some(name) = dependency.get("module_name").and_then(Value::as_str) else {
                continue;
            };
            if let Some((_, expected)) = EXPECTED_MODULES.iter().find(|(module, _)| *module == name)
            {
                let actual = dependency
                    .get("version")
                    .and_then(Value::as_str)
                    .unwrap_or("<missing>");
                if actual != *expected {
                    findings.fail(path, 1, format!("{name} is {actual}, expected {expected}"));
                }
            }
        }
    }
    if path
        .parent()
        .is_some_and(|pack| pack.join("entities").is_dir())
        && !kinds.contains("data")
    {
        findings.fail(
            path,
            1,
            "entities/ exists but the manifest declares no 'data' module",
        );
    }
}

fn check_lang(path: &Path, findings: &mut Findings) {
    let Ok(text) = read(path) else {
        findings.fail(path, 1, "could not read language file");
        return;
    };
    for (index, line) in text.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((_, value)) = trimmed.split_once('=') else {
            findings.fail(
                path,
                index + 1,
                "line with no key; a value cannot span lines",
            );
            continue;
        };
        if let Some(character) = value
            .chars()
            .find(|character| !character.is_ascii() && !SAFE_NON_ASCII.contains(*character))
        {
            findings.fail(
                path,
                index + 1,
                format!(
                    "U+{:04X} '{}' is not safe in shown text",
                    character as u32, character
                ),
            );
        }
    }
}

fn exported_names(text: &str) -> HashSet<String> {
    let pattern =
        Regex::new(r"(?m)^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)").unwrap();
    pattern
        .captures_iter(text)
        .map(|capture| capture[1].to_owned())
        .collect()
}

fn line_at(text: &str, byte: usize) -> usize {
    text[..byte].bytes().filter(|byte| *byte == b'\n').count() + 1
}

#[expect(
    clippy::too_many_lines,
    reason = "the tokenizer is one state machine; splitting it would hide state transitions"
)]
fn check_tokens(path: &Path, text: &str, findings: &mut Findings) {
    let bytes = text.as_bytes();
    let mut index = 0;
    let mut line = 1;
    let mut stack: Vec<(u8, usize)> = Vec::new();
    while index < bytes.len() {
        match bytes[index] {
            b'\n' => {
                line += 1;
                index += 1;
            }
            b'\\' => index = (index + 2).min(bytes.len()),
            b'/' if bytes.get(index + 1) == Some(&b'/') => {
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                let opened = line;
                index += 2;
                let mut closed = false;
                while index + 1 < bytes.len() {
                    if bytes[index] == b'\n' {
                        line += 1;
                    }
                    if bytes[index] == b'*' && bytes[index + 1] == b'/' {
                        index += 2;
                        closed = true;
                        break;
                    }
                    index += 1;
                }
                if !closed {
                    findings.fail(path, opened, "unterminated block comment");
                    return;
                }
            }
            quote @ (b'\'' | b'"') => {
                let opened = line;
                index += 1;
                while index < bytes.len() && bytes[index] != quote {
                    if bytes[index] == b'\\' {
                        index = (index + 2).min(bytes.len());
                        continue;
                    }
                    if bytes[index] == b'\n' {
                        findings.fail(path, opened, "string is still open at end of line");
                        return;
                    }
                    index += 1;
                }
                index = (index + 1).min(bytes.len());
            }
            b'`' => {
                let opened = line;
                index += 1;
                while index < bytes.len() && bytes[index] != b'`' {
                    if bytes[index] == b'\\' {
                        index = (index + 2).min(bytes.len());
                        continue;
                    }
                    if bytes[index] == b'\n' {
                        line += 1;
                    }
                    index += 1;
                }
                if index == bytes.len() {
                    findings.fail(path, opened, "template literal is never closed");
                    return;
                }
                index += 1;
            }
            opener @ (b'(' | b'[' | b'{') => {
                stack.push((opener, line));
                index += 1;
            }
            closer @ (b')' | b']' | b'}') => {
                let expected = match closer {
                    b')' => b'(',
                    b']' => b'[',
                    _ => b'{',
                };
                match stack.pop() {
                    Some((actual, _)) if actual == expected => {}
                    Some((actual, opened)) => {
                        findings.fail(
                            path,
                            line,
                            format!(
                                "'{}' from line {opened} closed by '{}'",
                                actual as char, closer as char
                            ),
                        );
                        return;
                    }
                    None => {
                        findings.fail(path, line, format!("stray '{}'", closer as char));
                        return;
                    }
                }
                index += 1;
            }
            _ => index += 1,
        }
    }
    for (opener, opened) in stack {
        findings.fail(
            path,
            opened,
            format!("'{}' is never closed", opener as char),
        );
    }
}

fn translation_keys() -> BTreeMap<String, HashSet<String>> {
    let mut answer: BTreeMap<String, HashSet<String>> = BTreeMap::new();
    for kind in PACK_KINDS {
        let folder = root().join(kind);
        for path in files_with_extension(&folder, "lang") {
            let language = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_owned();
            let keys = answer.entry(language).or_default();
            if let Ok(text) = read(&path) {
                for line in text.lines() {
                    if line.trim_start().starts_with('#') {
                        continue;
                    }
                    if let Some((key, _)) = line.split_once('=') {
                        keys.insert(key.trim().to_owned());
                    }
                }
            }
        }
    }
    answer
}

#[expect(
    clippy::too_many_lines,
    reason = "each source is checked once against shared compiled patterns and indexes"
)]
fn check_js(pack: &Path, findings: &mut Findings) -> Result<usize> {
    let files = files_with_extension(pack, "js");
    let mut sources = HashMap::new();
    let mut exports = HashMap::new();
    for path in &files {
        let source = read(path)?;
        exports.insert(path.canonicalize()?, exported_names(&source));
        sources.insert(path.clone(), source);
    }
    let languages = translation_keys();
    let import = Regex::new(r#"import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']"#)?;
    let config_use = Regex::new(r"CONFIG\.(\w+)")?;
    let literal_key = Regex::new(r#""(homestead\.[\w.]+)""#)?;
    let dynamic_key = Regex::new(r"`homestead\.[\w.]*\$\{")?;
    let shown_literal = Regex::new(r#""((?:[^"\\]|\\.)*)""#)?;
    let before = Regex::new(r#"beforeEvents,\s*"(\w+)""#)?;
    let config_path = pack.join("scripts/config.js");
    let config_text = sources.get(&config_path).cloned().unwrap_or_default();

    for (path, text) in &sources {
        for capture in import.captures_iter(text) {
            let source = &capture[2];
            if source.starts_with("@minecraft/") {
                continue;
            }
            let target = path.parent().unwrap().join(source);
            let line = line_at(text, capture.get(0).unwrap().start());
            if !target.exists() {
                findings.fail(
                    path,
                    line,
                    format!("import of a file that does not exist: {source}"),
                );
                continue;
            }
            let target = target.canonicalize()?;
            let available = exports.get(&target).cloned().unwrap_or_default();
            for requested in capture[1].split(',') {
                let name = requested.trim().split(" as ").next().unwrap_or("").trim();
                if !name.is_empty() && !available.contains(name) {
                    findings.fail(path, line, format!("'{name}' is not exported by {source}"));
                }
            }
        }
        if path != &config_path {
            for capture in config_use.captures_iter(text) {
                let key = &capture[1];
                let definition = Regex::new(&format!(r"(?m)^\s*{}\s*:", regex::escape(key)))?;
                if !definition.is_match(&config_text) {
                    findings.fail(
                        path,
                        line_at(text, capture.get(0).unwrap().start()),
                        format!("CONFIG.{key} does not exist in config.js"),
                    );
                }
            }
        }
        for capture in literal_key.captures_iter(text) {
            let key = &capture[1];
            let line = line_at(text, capture.get(0).unwrap().start());
            for (language, defined) in &languages {
                if !defined.contains(key) {
                    findings.fail(
                        path,
                        line,
                        format!("key '{key}' missing from {language}.lang"),
                    );
                }
            }
        }
        for found in dynamic_key.find_iter(text) {
            findings.warn(
                path,
                line_at(text, found.start()),
                "translation key built at runtime: not verified against language files",
            );
        }
        for capture in shown_literal.captures_iter(text) {
            if !capture[1].contains('§') {
                continue;
            }
            if let Some(character) = capture[1]
                .chars()
                .find(|character| !character.is_ascii() && !SAFE_NON_ASCII.contains(*character))
            {
                findings.fail(
                    path,
                    line_at(text, capture.get(0).unwrap().start()),
                    format!(
                        "U+{:04X} '{}' is not safe in shown text",
                        character as u32, character
                    ),
                );
            }
        }
        check_tokens(path, text, findings);

        for capture in before.captures_iter(text) {
            let start = capture.get(0).unwrap().end();
            let remainder = &text[start..];
            let body_end = remainder.find("});").unwrap_or(remainder.len());
            let body = &remainder[..body_end];
            if [
                "sendMessage(",
                "setActionBar(",
                "spawnItem(",
                "setType(",
                "addItem(",
            ]
            .iter()
            .any(|needle| body.contains(needle))
                && !body.contains("system.run")
            {
                findings.warn(
                    path,
                    line_at(text, capture.get(0).unwrap().start()),
                    format!(
                        "beforeEvents.{}: side effect may be outside system.run",
                        &capture[1]
                    ),
                );
            }
        }
    }
    Ok(files.len())
}

fn check() -> Result<()> {
    let mut findings = Findings::default();
    let version = release_version()?;
    let config_path = root().join("behavior_packs/homestead/scripts/config.js");
    let config_text = read(&config_path)?;
    let shown_version = Regex::new(r#"(?s)credits\s*:\s*\{.*?version\s*:\s*"([^"]+)""#)?
        .captures(&config_text)
        .and_then(|capture| capture.get(1))
        .map(|value| value.as_str());
    if shown_version != Some(version.as_str()) {
        findings.fail(
            &config_path,
            1,
            format!("credits version {shown_version:?} does not match VERSION {version}"),
        );
    }
    let mut packs = Vec::new();
    for kind in PACK_KINDS {
        let folder = root().join(kind);
        if !folder.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&folder)? {
            let pack = entry?.path();
            if pack.join("manifest.json").is_file() {
                packs.push(pack);
            }
        }
    }
    packs.sort();
    if packs.is_empty() {
        bail!("no packs found")
    }
    for pack in &packs {
        let manifest = manifest_version(pack)?;
        if manifest != core_version(&version) {
            findings.fail(
                &pack.join("manifest.json"),
                1,
                format!(
                    "manifest version {manifest} does not match VERSION core {}",
                    core_version(&version)
                ),
            );
        }
    }

    let mut total = 0;
    for pack in &packs {
        check_manifest(&pack.join("manifest.json"), &mut findings);
        for path in files_with_extension(pack, "json") {
            if path.file_name().and_then(|value| value.to_str()) != Some("manifest.json") {
                json(&path, &mut findings);
            }
        }
        for path in files_with_extension(pack, "lang") {
            check_lang(&path, &mut findings);
        }
        let count = check_js(pack, &mut findings)?;
        total += count;
        println!("  {}: {count} js files", shown(pack));
    }
    println!("\n{total} files checked across {} packs\n", packs.len());
    if !findings.warnings.is_empty() {
        println!("WARNINGS ({}):", findings.warnings.len());
        for warning in findings.warnings {
            println!("  {warning}");
        }
        println!();
    }
    if !findings.failures.is_empty() {
        eprintln!("FAILURES ({}):", findings.failures.len());
        for failure in findings.failures {
            eprintln!("  {failure}");
        }
        bail!("checks failed");
    }
    println!("no failures");
    Ok(())
}

fn stress() -> Result<()> {
    let status = Command::new("node")
        .arg("--experimental-vm-modules")
        .arg("tools/stress.mjs")
        .current_dir(root())
        .status()
        .context("could not start Node.js")?;
    if !status.success() {
        bail!("logic stress tests failed")
    }
    Ok(())
}

fn manifest_version(pack: &Path) -> Result<String> {
    let value: Value = serde_json::from_str(&read(&pack.join("manifest.json"))?)?;
    let parts = value
        .pointer("/header/version")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("{} has no header.version", shown(pack)))?;
    Ok(parts
        .iter()
        .map(|part| part.as_u64().unwrap_or(0).to_string())
        .collect::<Vec<_>>()
        .join("."))
}

fn archive(path: &Path, parts: &[(&Path, &str)]) -> Result<usize> {
    if path.exists() {
        fs::remove_file(path)?;
    }
    let file = File::create(path)?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut count = 0;
    for (folder, prefix) in parts {
        if !folder.is_dir() {
            bail!("missing pack folder: {}", shown(folder))
        }
        let mut files: Vec<_> = WalkDir::new(folder)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .map(walkdir::DirEntry::into_path)
            .collect();
        files.sort();
        for source in files {
            let relative = source
                .strip_prefix(folder)?
                .to_string_lossy()
                .replace('\\', "/");
            let name = if prefix.is_empty() {
                relative
            } else {
                format!("{prefix}/{relative}")
            };
            writer.start_file(name, options)?;
            let mut input = File::open(&source)?;
            let mut bytes = Vec::new();
            input.read_to_end(&mut bytes)?;
            writer.write_all(&bytes)?;
            count += 1;
        }
    }
    writer.finish()?;
    Ok(count)
}

fn verify_archive(path: &Path, manifests: &[&str]) -> Result<()> {
    let mut archive = ZipArchive::new(File::open(path)?)?;
    let mut names = BTreeSet::new();
    for index in 0..archive.len() {
        names.insert(archive.by_index(index)?.name()?.into_owned());
    }
    for manifest in manifests {
        if !names.contains(*manifest) {
            bail!("{}: manifest not at pack root: {manifest}", shown(path))
        }
    }
    Ok(())
}

fn build(all: bool) -> Result<()> {
    let behavior = root().join("behavior_packs/homestead");
    let resource = root().join("resource_packs/homestead");
    let bp_version = manifest_version(&behavior)?;
    let rp_version = manifest_version(&resource)?;
    if bp_version != rp_version {
        bail!("manifest versions disagree: BP {bp_version}, RP {rp_version}")
    }
    let release_version = release_version()?;
    if bp_version != core_version(&release_version) {
        bail!(
            "manifest version {bp_version} does not match VERSION core {}",
            core_version(&release_version)
        )
    }
    let dist = root().join("dist");
    fs::create_dir_all(&dist)?;
    for entry in fs::read_dir(&dist)? {
        let path = entry?.path();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let extension = path.extension().and_then(|value| value.to_str());
        if name.starts_with("Homestead_") && matches!(extension, Some("mcaddon" | "mcpack")) {
            fs::remove_file(path)?;
        }
    }

    let combined = dist.join(format!("Homestead_v{release_version}.mcaddon"));
    let count = archive(
        &combined,
        &[(&behavior, "homestead_BP"), (&resource, "homestead_RP")],
    )?;
    verify_archive(
        &combined,
        &["homestead_BP/manifest.json", "homestead_RP/manifest.json"],
    )?;
    println!(
        "built: {}  ({count} files)",
        combined.file_name().unwrap().to_string_lossy()
    );

    if all {
        for (source, label) in [(&behavior, "BP"), (&resource, "RP")] {
            let path = dist.join(format!("Homestead_{label}_v{release_version}.mcpack"));
            let count = archive(&path, &[(source, "")])?;
            verify_archive(&path, &["manifest.json"])?;
            println!(
                "built: {}  ({count} files)",
                path.file_name().unwrap().to_string_lossy()
            );
        }
    }
    println!("\nversion {release_version} -> {}", dist.display());
    Ok(())
}
