export type UiSound = "navigate" | "press" | "select" | "success" | "toggle-off" | "toggle-on";

export const UI_SOUND_STORAGE_KEY = "autoeval:sound-enabled";

let audioContext: AudioContext | null = null;

const soundShape: Record<UiSound, Array<{ frequency: number; delay: number; duration: number }>> = {
  navigate: [{ frequency: 430, delay: 0, duration: 0.045 }],
  press: [{ frequency: 330, delay: 0, duration: 0.035 }],
  select: [{ frequency: 520, delay: 0, duration: 0.03 }],
  success: [
    { frequency: 440, delay: 0, duration: 0.055 },
    { frequency: 660, delay: 0.055, duration: 0.085 },
  ],
  "toggle-off": [{ frequency: 300, delay: 0, duration: 0.06 }],
  "toggle-on": [
    { frequency: 420, delay: 0, duration: 0.045 },
    { frequency: 560, delay: 0.045, duration: 0.075 },
  ],
};

export function playUiSound(sound: UiSound) {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return;

  audioContext ??= new window.AudioContext();
  const context = audioContext;
  if (context.state === "suspended") void context.resume();

  for (const tone of soundShape[sound]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startsAt = context.currentTime + tone.delay;
    const endsAt = startsAt + tone.duration;

    oscillator.type = sound === "success" || sound === "toggle-on" ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(tone.frequency, startsAt);
    gain.gain.setValueAtTime(0.0001, startsAt);
    gain.gain.exponentialRampToValueAtTime(0.022, startsAt + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startsAt);
    oscillator.stop(endsAt + 0.01);
  }
}

export function playPreferredUiSound(sound: UiSound) {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(UI_SOUND_STORAGE_KEY) === "false") return;
  playUiSound(sound);
}
