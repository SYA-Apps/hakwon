// 학원비서 웹 — 앱 파일을 **폰에 붙들어 두는** 서비스워커 (2026-09-30 · 땀방울 sw.js 를 옮겼다)
//
// 🔴 왜(땀방울에서): 사용자 «로딩은 아직도 느려». 원인은 파일 크기보다 **캐시가 사실상 없는 것**이었다.
//    · GitHub Pages 는 파일을 10분만 캐시하라고 한다(max-age=600)
//    · Flutter 의 서비스워커는 이제 **스스로 지워지는 빈껍데기**라 아무것도 안 붙든다
//    · 아이폰(특히 홈 화면에 추가한 앱)은 브라우저 캐시를 자주 비운다
//    → 열 때마다 엔진·앱·글꼴 약 5MB 를 다시 받았다.
//
// 어떻게:
//  1. 앱 파일(같은 사이트 · /hakwon/ 안 · GET)은 **캐시 먼저** — 있으면 인터넷을 안 탄다
//  2. 페이지 자체(index.html · join.html · privacy.html)는 **인터넷 먼저** — 새 판을 알아채는 자리다
//  3. 판이 바뀌면 index.html 이 `sw.js?b=<새 번호>` 로 다시 등록한다 → 새 워커가 옛 캐시를 통째로 지운다
//     (번호는 배포 때 `tool/stamp_web.py` 가 main.dart.js 의 지문으로 박는다)
//  4. 첫 화면이 뜬 뒤 페이지가 «내가 받은 파일 목록» 을 보내 주면 그것만 캐시에 채운다
//     — 아이폰은 아이폰용 엔진만, PC 는 PC 용만 담긴다(둘 다 담으면 3MB 를 헛받는다)
//
// 🚨 `preview/`(시험판)는 건드리지 않는다 — 학원비서엔 아직 없지만 땀방울과 규칙을 맞춰 둔다.
// 🚨 서버(Supabase)·다른 사이트 요청은 건드리지 않는다.

const B = new URL(self.location.href).searchParams.get('b') || 'none';
const SCOPE = new URL(self.registration.scope).pathname; // "/hakwon/" (시험판은 "/hakwon/preview/")
// 🚨 캐시 이름에 폴더를 넣는다 — 시험판도 같은 사이트라, 안 넣으면 둘이 서로의 캐시를 지운다.
const PREFIX = 'hakwon:' + SCOPE + ':';
const CACHE = PREFIX + B;
// 🔤 구글이 주는 **대체 글꼴**(이모지 · 한글 조각 · 기호). 엔진이 우리 글꼴에 없는 글자를 그릴 때 받는다.
//    (땀방울에서 실측 — 이모지를 쓰는 화면이면 열 때마다 받고 있었다. 이 앱도 쓴다.)
//    주소가 내용마다 고정이라 바뀌지 않는다 → 판이 바뀌어도 지우지 않는 따로 된 캐시에 둔다.
const FONTS = 'hakwon:gstatic';
const PAGES = /\/(index\.html|join\.html|privacy\.html)?$/;
const NEVER = /\/(sw\.js|version\.json|flutter_service_worker\.js)$/;

// 🚨 skipWaiting · clients.claim 을 쓰지 않는다(2026-10-01 ADMIN · 사용자 승인) — 열린 앱에서 새 워커가 넘겨받으면 옛 main.dart.js 와 새 자료가 섞인다. 새 판은 앱을 완전히 닫았다 열 때 바뀐다.
self.addEventListener('install', () => {});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k); // FONTS 는 PREFIX 로 시작하지 않아 남는다
    }
  })());
});

function gstatic(url) {
  return url.hostname === 'fonts.gstatic.com';
}

function mine(url) {
  return url.origin === self.location.origin &&
    url.pathname.startsWith(SCOPE) &&
    !url.pathname.startsWith(SCOPE + 'preview/') &&
    !NEVER.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (gstatic(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }
  if (!mine(url)) return;
  if (req.mode === 'navigate' || PAGES.test(url.pathname)) return; // 페이지는 늘 인터넷에서
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  })());
});

// 페이지가 첫 화면을 그린 뒤 보내 주는 «받은 파일 목록» — 없는 것만 채운다.
// `no-cache` 로 받는다: 브라우저 캐시에 남은 **옛 판**을 새 캐시에 담지 않으려는 것이다(서버에 한 번 물어본다 · 같으면 304).
self.addEventListener('message', (event) => {
  // 사람이 「새 판 · 눌러서 바꾸기」 를 누른 때만 넘겨받는다 — 페이지가 곧바로 통째로 다시 열린다(index.html)
  if (event.data && event.data.skip) {
    self.skipWaiting();
    return;
  }
  const list = (event.data && event.data.warm) || [];
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const u of list) {
      try {
        const url = new URL(u);
        if (gstatic(url)) {
          const fc = await caches.open(FONTS);
          if (!(await fc.match(url.href))) {
            const r = await fetch(url.href, { mode: 'cors' });
            if (r.ok) await fc.put(url.href, r);
          }
          continue;
        }
        if (!mine(url) || PAGES.test(url.pathname)) continue;
        if (await cache.match(url.href, { ignoreSearch: true })) continue;
        const res = await fetch(url.href, { cache: 'no-cache' });
        if (res.ok && res.type === 'basic') await cache.put(url.href, res);
      } catch (_) { /* 한 파일이 실패해도 나머지는 담는다 */ }
    }
  })());
});
