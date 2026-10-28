/**
 * Every way of driving the show (keyboard, clicker, mouse — and later a phone
 * over WebSocket) goes through this one bus, so a remote just has to call
 * `commands.send("next")`.
 */
export type Command = "next" | "prev" | "reset" | "blackout";

type Listener = (cmd: Command) => void;

const listeners = new Set<Listener>();

export const commands = {
  send(cmd: Command) {
    listeners.forEach((l) => l(cmd));
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
