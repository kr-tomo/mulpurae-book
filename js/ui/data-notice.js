import { h } from './dom.js';

export const GEMINI_TERMS_URL = 'https://ai.google.dev/gemini-api/terms';

/** Data-transfer notice shared by the consent dialog and the settings screen (SPEC-102 §4.3). */
export function renderDataNotice() {
  return h(
    'ul',
    { class: 'data-notice' },
    h('li', null, '선택한 영수증 이미지는 분석을 위해 Google Gemini API 로 전송됩니다.'),
    h('li', null, '이미지는 Google Sheets·Drive 에 저장되지 않습니다.'),
    // OI-003: replace with the confirmed free-tier data-use statement.
    h('li', null, '무료 등급에서는 입력 데이터가 Google 서비스 개선에 사용될 수 있으니 약관을 확인하세요.'),
    h('li', null, h('a', { href: GEMINI_TERMS_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Gemini API 약관')),
  );
}
