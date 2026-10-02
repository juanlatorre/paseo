# iOS Simulator panel

The Simulator panel mirrors a booted iOS Simulator into a workspace pane: live view, tap, drag,
hardware buttons, rotation, and text input.

## How it works

The daemon shells out to [serve-sim](https://github.com/EvanBacon/serve-sim) (Apache-2.0), the same
helper Orca uses. serve-sim talks to Apple's SimulatorKit, serves an MJPEG stream of the simulator
framebuffer on a loopback port, and accepts touch frames over a local WebSocket. It is pinned to an
exact version in `packages/server/package.json` because the touch-frame wire shape
(`0x03` tag + JSON `{type, x, y}`, normalized coordinates) is serve-sim's internal protocol, not a
public contract — bump the pin, re-run the live test.

The daemon brokers everything; clients never talk to the helper directly:

- Frames are re-emitted as simulator binary frames (`0x20` opcode + slot) over the daemon's
  WebSocket, following the terminal slot pattern, so the panel works from any paired client,
  including phones over the relay.
- Tap and drag become serve-sim touch frames over the helper WebSocket; `type`, `button`, and
  `rotate` go through the serve-sim CLI. Taps use normalized coordinates, so the panel just divides
  touch position by the stage size.

## Platform and availability

- macOS only. The broker is constructed in `bootstrap.ts` only when `process.platform === "darwin"`,
  and `server_info.features.iosSimulator` is advertised only when the broker exists
  (`// COMPAT(iosSimulator)` on both sides of the gate).
- The launcher hides the panel when the daemon doesn't advertise the feature; the panel itself shows
  an update-the-host message as a second gate.

## Gotchas

- serve-sim needs Simulator.app attached for display and rotation; it opens it itself. Hiding or
  quitting Simulator.app mid-session can stall the stream.
- A booted device can come up with its display IO port down (HID alive, no framebuffer). The stream
  then fails with "No framebuffer display descriptor found". Recovery is `xcrun simctl erase <udid>`
  or rebooting the device — see how Orca handles the same wedge in its iOS backend.
- JPEG frames are full device resolution (~280 KB each at ~4 fps on an iPhone 15). There is no
  downscaling or coalescing; backpressure protection is the shared
  `MAX_PHYSICAL_SOCKET_BUFFER_SIZE` bound on the outbound socket.

## Testing

`packages/server/src/simulator/` has unit tests for the parsers. The full loop (real daemon, real
serve-sim, real simulator) runs only on a Mac with a booted simulator:

```bash
RUN_LIVE_SIMULATOR_E2E=1 npx vitest run src/simulator --bail=1   # from packages/server
```
