// What should happen when the user taps a menu item?
//
// Background (root App.jsx): navigation is a plain array "stack" of screens.
//   navigate(name) pushes a screen, replace(name) swaps the top screen,
//   goBack() pops the top screen.
// Every menu screen (Home, Profile, Messages, Settings, ProductCamera) is opened from
// Home, so Home always sits directly beneath the current menu screen:
//   [..., Home, Messages]
// We want Back to always land on Home, wherever the user hopped to from the menu.
//
// Returns one of:
//   'close'    the tapped item is the screen already showing: just close the menu.
//   'back'     the target is Home: pop the current screen (Home is right beneath it).
//   'navigate' we are on Home: push the target, giving [..., Home, target].
//   'replace'  we are on another menu screen: swap it for the target, keeping the
//              stack [..., Home, target] (a push would give [..., Home, current,
//              target] and Back would return to the wrong screen).
export function menuAction(currentScreen, targetScreen) {
  if (targetScreen === currentScreen) return 'close';
  if (targetScreen === 'Home') return 'back';
  if (currentScreen === 'Home') return 'navigate';
  return 'replace';
}
