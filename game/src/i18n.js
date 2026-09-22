// The game is almost text-free; these are the few words it shows.
const STRINGS = {
  en: {
    level: 'LEVEL', clear: 'CLEAR!', retry: 'RETRY', tryAgain: 'TRY AGAIN', next: 'NEXT',
    hint: 'HINT', ink: 'INK +50%', levels: 'LEVELS', long: 'LONG STAGE',
    water: 'SPLASH!', spiked: 'OUCH!', flipped: 'FLIPPED!', stuck: 'STUCK!', timeout: 'TOO SLOW!', lost: 'LOST!',
  },
  ja: {
    level: 'レベル', clear: 'クリア！', retry: 'リトライ', tryAgain: 'もう一回', next: '次へ',
    hint: 'ヒント', ink: 'インク+50%', levels: 'レベル選択', long: 'ロングステージ',
    water: 'ドボン！', spiked: 'いたっ！', flipped: 'ひっくり返った！', stuck: '止まっちゃった！', timeout: '時間切れ！', lost: 'どこかへ行っちゃった！',
  },
};

let table = STRINGS.en;

export function setLanguage(tag) {
  const base = String(tag || 'en').toLowerCase().split('-')[0];
  table = STRINGS[base] || STRINGS.en;
  document.documentElement.lang = STRINGS[base] ? base : 'en';
}

export const t = (key) => table[key] ?? STRINGS.en[key] ?? key;
