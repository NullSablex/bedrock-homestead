/**
 * Defensive event subscription.
 *
 * The Bedrock Script API moves between versions: an event that existed in 1.21
 * may be gone or beta-only in 1.26. Without this, ONE invalid subscription
 * throws at load time and takes the WHOLE add-on down — no check runs and
 * nothing ever reaches the chat.
 *
 * Here each subscription fails on its own, and the reason goes to the content
 * log where it can be read.
 */

const failures = [];

/**
 * Subscriptions that failed but whose job is being done another way.
 *
 * The distinction matters on the status screen: "one event did not subscribe"
 * reads as a hole in the protection, and reporting a covered gap that way
 * teaches the reader to ignore the screen — which is the one thing a status
 * screen cannot afford.
 */
const notes = [];

/**
 * @param bus      world.afterEvents, world.beforeEvents, system.afterEvents...
 * @param name     event name
 * @param handler  callback
 * @param options  event filter options (optional)
 * @returns true when the subscription succeeded
 */
export function subscribeSafe(bus, name, handler, options) {
  try {
    const signal = bus?.[name];
    if (!signal || typeof signal.subscribe !== "function") {
      failures.push(`${name}: not available in this API version`);
      console.warn(`[Homestead] event not available: ${name}`);
      return false;
    }
    if (options) signal.subscribe(handler, options);
    else signal.subscribe(handler);
    return true;
  } catch (e) {
    failures.push(`${name}: ${e}`);
    console.warn(`[Homestead] could not subscribe to ${name}: ${e}`);
    return false;
  }
}

/** Events that could not be subscribed and are not covered by anything else. */
export function subscriptionFailures() {
  return [...failures];
}

/** Gaps that were closed another way, reported separately. */
export function subscriptionNotes() {
  return [...notes];
}

/**
 * Moves a failure to the notes: the event is still missing, but something else
 * is doing its work, so it is no longer a hole.
 */
export function coveredElsewhere(name, how) {
  const index = failures.findIndex((entry) => entry.startsWith(`${name}:`));
  if (index >= 0) failures.splice(index, 1);
  notes.push(`${name}: ${how}`);
}
