// Thin wrapper over the YouTube Playables SDK (window.ytgame).
// Outside Playables (local dev) it falls back to localStorage and a fake ad
// so the whole game can be played and tested in a normal browser.
const yt = typeof window !== 'undefined' ? window.ytgame : undefined;
export const IN_PLAYABLES = !!(yt && yt.IN_PLAYABLES_ENV);

const LOCAL_KEY = 'draw-road-rush-save';
let loaded = false;

export function firstFrameReady() {
  if (IN_PLAYABLES) yt.game.firstFrameReady();
}

export function gameReady() {
  if (IN_PLAYABLES) yt.game.gameReady();
}

export async function loadData() {
  let raw = '';
  try {
    if (IN_PLAYABLES) raw = await yt.game.loadData();
    else raw = localStorage.getItem(LOCAL_KEY) || '';
  } catch (e) {
    logError(e);
  }
  loaded = true;
  return raw;
}

export async function saveData(str) {
  // The SDK rejects saves made before loadData() has finished.
  if (!loaded) return;
  try {
    if (IN_PLAYABLES) await yt.game.saveData(str);
    else localStorage.setItem(LOCAL_KEY, str);
  } catch (e) {
    logError(e);
  }
}

export async function getLanguage() {
  try {
    if (IN_PLAYABLES) return await yt.system.getLanguage();
  } catch (e) {
    logError(e);
  }
  return navigator.language || 'en';
}

export function isAudioEnabled() {
  return IN_PLAYABLES ? yt.system.isAudioEnabled() : true;
}

export function onAudioEnabledChange(cb) {
  if (IN_PLAYABLES) yt.system.onAudioEnabledChange(cb);
}

// Pause/resume come only from the SDK (the Page Visibility API must not be used).
export function onPause(cb) {
  if (IN_PLAYABLES) yt.system.onPause(cb);
}

export function onResume(cb) {
  if (IN_PLAYABLES) yt.system.onResume(cb);
}

export async function showInterstitial() {
  try {
    if (IN_PLAYABLES) await yt.ads.requestInterstitialAd();
  } catch (e) {
    // No ad available is normal; the game just continues.
  }
}

// Resolves true when the player earned the reward.
export async function showRewarded(rewardId) {
  try {
    if (IN_PLAYABLES) return await yt.ads.requestRewardedAd(rewardId);
    return await fakeAd();
  } catch (e) {
    return false;
  }
}

export function logError(e) {
  console.error(e);
  if (IN_PLAYABLES) yt.health.logError();
}

// Local stand-in for a rewarded ad so the flow can be tested without YouTube.
function fakeAd() {
  return new Promise((resolve) => {
    const el = document.getElementById('fake-ad');
    el.hidden = false;
    let left = 2;
    const label = el.querySelector('span');
    label.textContent = `AD ${left}`;
    const t = setInterval(() => {
      left -= 1;
      label.textContent = `AD ${left}`;
      if (left <= 0) {
        clearInterval(t);
        el.hidden = true;
        resolve(true);
      }
    }, 700);
  });
}
