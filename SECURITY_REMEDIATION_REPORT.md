# LOONG — تقرير الإصلاح الأمني والتحقق النهائي

**النطاق:** النتائج P-1 … P-10 من تقرير الفحص الجنائي، + تقييم T-1 / T-2، + نتيجة جديدة P-11 ظهرت أثناء التحقق.

**القاعدة الحاكمة:** لا بند يُعدّ مُصلحًا إلا إذا كان له (١) تعديل في الكود بمرجع `ملف:سطر`، (٢) اختبار يعيد إنتاجه، (٣) دليل أن الاختبار **يفشل** على الكود القديم.

**نسخة الاستعادة:** `backups/pre-remediation/` — نسخة كاملة من `server/ electron/ tests/ scripts/ package.json vite.config.ts index.html` قبل أي تعديل.

---

## 1. الحكم النهائي

| # | النتيجة | الحالة | الدليل |
|---|---|---|---|
| P-1 | الخادم يستمع على كل الواجهات | **مُصلح** | `server/config.ts:32` + `server/start.ts:13` |
| P-2 | «لا توكن» = مفتوح للشبكة | **مُصلح** | `server/index.ts:94,101,121` |
| P-3 | مفتاح الـ rate-limit من هيدر يكتبه المهاجم | **مُصلح** | `server/index.ts:171` |
| P-4 | إعداد MCP يُنفَّذ بلا تحقق | **مُصلح** | `server/mcp.ts:109,111` + `server/index.ts:437` |
| P-5 | مخرجات الأدوات تصل للنموذج كأوامر | **مُصلح** | `server/agent.ts:454` |
| P-6 | الـ renderer يستطيع التنقل خارج الواجهة | **مُصلح** | `electron/main.cjs:240,348,354` |
| P-7 | النوافذ المنبثقة تُسمح لكل ما ليس http | **مُصلح** | `electron/main.cjs:338` |
| P-8 | `no-sandbox` مفروض على كل جهاز | **مُصلح** | `electron/main.cjs:494` |
| P-9 | CSP ناقص (object-src/base-uri/frame-ancestors/form-action) | **مُصلح** | `electron/main.cjs:328` |
| P-10 | ملف مفاتيح plaintext يبقى على القرص | **مُصلح** | `electron/main.cjs:230` + `mode: 0o600` |
| **P-11** | **إشارة الإيقاف تُفقد أثناء التهيئة** | **مُصلح (جديد)** | `server/agent.ts:1134,1496` |
| T-1 | إعادة ربط DNS عبر فحص Origin | **نظري — غير قابل للاستغلال كما هو** | §5 |
| T-2 | حقن أوامر عبر محتوى الصفحات/الأدوات | **نظري — مُخفَّف لا مُغلق** | §5 |

**الاختبارات:** `206/206` تمر (كانت `205/206` قبل إصلاح P-11).
**TypeScript:** `tsc -p tsconfig.server.json` نظيف، `tsc --noEmit` نظيف.
**الاعتماديات:** `npm audit --omit=dev` → **0 ثغرة** في 163 حزمة إنتاج. (25 ثغرة في حزم التطوير فقط — §6.)

---

## 2. المنهجية — كيف تعيد إنتاج كل سطر هنا

```cmd
:: الاختبارات كلها
node --test --import tsx "tests/*.test.ts"

:: اختبارات الإصلاح وحدها (23 اختبارًا)
node --test --import tsx tests/remediation.test.ts

:: الفحص النوعي
npx tsc -p tsconfig.server.json && npx tsc --noEmit

:: الاعتماديات
npm audit --omit=dev
```

كل اختبار في `tests/remediation.test.ts` مكتوب بحيث **يفشل** على `backups/pre-remediation/`. هذا ليس ادعاءً: تحققت منه فعليًا بنسخ الاختبار إلى مجلد النسخة القديمة وتشغيله هناك (السجل: `tmp/old-code-proof.log`)، وبمسبار مستقل لـ P-11 (`tmp/probe-old.ts` → `RUN_FINISHED emitted: true`، وبعد الإصلاح `false`).

---

## 3. النتائج — قبل / بعد / الدليل

### P-1 — الخادم كان يستمع على كل الواجهات

**قبل:** `serve({ fetch: app.fetch, port: PORT })` بلا `hostname` → Node يربط `0.0.0.0`. عملية تنفّذ أوامر shell وتكتب ملفات كانت مكشوفة لكل من على نفس شبكة الواي فاي.

**بعد:** `server/config.ts:32`

```ts
export const HOST = process.env.LOONG_HOST ?? '127.0.0.1'
```

و`server/start.ts:13` يمرّرها: `serve({ fetch: app.fetch, port: PORT, hostname: HOST }, …)`.

**الدليل الحي:** تشغيل الخادم على منفذ 5299 أعطى `TCP 127.0.0.1:5299 … LISTENING` بدل `0.0.0.0:5299`. ومن يريد الشبكة يكتب `LOONG_HOST=0.0.0.0` — قرار مكتوب لا افتراضي لم يختره أحد.

**الاختبارات:** `the default bind address is loopback, not every interface` · `the bind address is the one handed to the server, not a default`.

---

### P-2 — «لا يوجد توكن» كان يعني «اقبل الجميع»

**قبل:**

```ts
if (SESSION_TOKEN && c.req.header('x-loong-token') !== SESSION_TOKEN) return 401
```

في وضع التطوير (بلا توكن) الشرط كله يُتخطّى → أي جهاز على الشبكة يتحكم بالوكيل.

**بعد:** `server/index.ts:121`

```ts
const peer = peerAddress(c)
if (SESSION_TOKEN) {
  if (c.req.header('x-loong-token') !== SESSION_TOKEN) return c.json({ … }, 401)
} else if (peer && !isLoopbackPeer(peer)) {
  return c.json({ error: 'This agent accepts unsigned requests from this machine only.' }, 403)
}
```

`peerAddress` (`:94`) يقرأ **عنوان السوكيت** من `c.env.incoming.socket.remoteAddress`، و`isLoopbackPeer` (`:101`) يقبل `127.0.0.0/8` و`::1` و`::ffff:127.x` فقط — بتعبير نمطي مُقيَّد بأربع خانات، لأن مطابقة البداية `127.` وحدها كانت ستقبل اسمًا مثل `127.evil.com`.

**الدليل الحي:** مع توكن مضبوط، `curl http://127.0.0.1:5299/api/workspace` → `HTTP/1.1 401 Unauthorized`. وبلا توكن من loopback → يُخدم. ومن عنوان غير loopback → `403` (اختبار).

**الاختبارات:** 5 اختبارات، منها `x-forwarded-for cannot smuggle a remote request past the gate` و`a request with no socket at all is treated as local`.

---

### P-3 — محدِّد المعدل كان مفتاحه هيدرًا يكتبه الطالب

**قبل:** `clientIp` = `x-forwarded-for.split(',')[0] || 'local'` → كل طلب بهيدر جديد = دلو جديد = لا تحديد إطلاقًا.

**بعد:** `server/index.ts:171` — المفتاح هو عنوان السوكيت نفسه:

```ts
function clientIp(c: { env: unknown }): string {
  return peerAddress(c) || 'local'
}
```

**الاختبار:** `x-forwarded-for cannot buy a fresh rate-limit bucket`.

---

### P-4 — إعداد MCP هو برنامج سيشغّله التطبيق

**قبل:** `PUT /api/mcp` يأخذ JSON من الواجهة ويحفظه كما هو، ثم `spawn(command, args)`. أي XSS في الواجهة = تنفيذ برنامج.

**بعد:** `server/mcp.ts:111` — `assertSafeMcpConfig` يتحقق من الشكل قبل أي `spawn`:

- `command`: نص غير فارغ، **بلا** محارف shell (`SHELL_META` في `:109`).
- `args`: مصفوفة نصوص فقط.
- `url`: يجب أن تبدأ بـ `http://` أو `https://`.
- كل مدخل يحتاج `command` أو `url`.
- `mcpServers` كائن لا مصفوفة.

و`server/index.ts:437` يستدعيها قبل `saveMcpConfig` ويرد `400` برسالة محددة.

**الاختبارات:** 6 اختبارات، منها `the MCP endpoint answers 400 instead of spawning a bad entry` و`an ordinary MCP server is still accepted` (لا نكسر الحالة الشريفة).

---

### P-5 — مخرجات الأدوات كانت تصل للنموذج كأنها كلامه

**قبل:** `return typeof out === 'string' ? out : JSON.stringify(out)` — صفحة ويب يجلبها الوكيل تُصبح نصًا في سياق النموذج بلا حدود.

**بعد:** `server/agent.ts:454` — `frameUntrustedOutput(tool, text)` يغلّف كل مخرجات أي أداة داخل سياج يعلن أنها بيانات، ويُهرّب أي محاولة للخروج من السياج.

**الاختبارات:** `tool output is wrapped in the untrusted fence` · `a page cannot climb out of its own fence` · `empty output is left alone`.

---

### P-6 — الـ renderer كان يستطيع مغادرة الواجهة

**قبل:** لا `will-navigate` ولا `will-redirect`. جسر `preload` مربوط **بالنافذة** لا بالأصل، فصفحة تستولي على النافذة ترث `window.loong` — **بما فيه توكن الجلسة** — والوكيل يثق بكل من يحمل التوكن. رابط Markdown يكتبه النموذج يكفي للوصول.

**بعد:** `electron/main.cjs:240` (`isAppUrl`) + `:348` (`blockNavigation`) + `:354-355` مربوطًا على `will-navigate` و`will-redirect`. أي عنوان خارج الواجهة يُمنع، و`http(s)` يُسلَّم للمتصفح الحقيقي.

**الاختبار:** `the renderer cannot navigate away from the interface`.

---

### P-7 — النوافذ المنبثقة: `allow` لكل ما ليس http

**قبل:**

```js
if (url.startsWith('http')) { shell.openExternal(url); return { action: 'deny' } }
return { action: 'allow' }   // file:// وأي scheme مخصص
```

`file://` أو scheme مخصص كان يفتح نافذة **بجسر preload** داخلها.

**بعد:** `electron/main.cjs:338` — الرفض هو الافتراضي، و`http(s)` فقط يُسلَّم للمتصفح:

```js
if (/^https?:\/\//i.test(url)) shell.openExternal(url)
return { action: 'deny' }
```

**الاختبار:** `every popup is denied, not just the non-http ones`.

---

### P-8 — `no-sandbox` مفروض على الجميع

**قبل:** `app.commandLine.appendSwitch('no-sandbox')` بلا شرط → `sandbox: true` في `webPreferences` كان زينة. الـ renderer الذي يُحلّل مخرجات النموذج وصفحات مجلوبة كان يعمل بلا sandbox **على كل جهاز**، لإرضاء أجهزة قليلة تفشل عند الإقلاع.

**بعد:** `electron/main.cjs:494`

```js
if (process.env.LOONG_NO_SANDBOX === '1') {
  diag('LOONG_NO_SANDBOX=1 — Chromium sandbox disabled by explicit request')
  app.commandLine.appendSwitch('no-sandbox')
}
```

**الاختبار:** `the Chromium sandbox is on unless the operator turns it off` — يثبت أن المفتاح يظهر **مرة واحدة**، وأن شرط البيئة يسبقه ويحيط به.

---

### P-9 — CSP بلا `object-src` / `base-uri` / `frame-ancestors` / `form-action`

**قبل:** `default-src 'self' file:; script-src …; connect-src 'self' http://127.0.0.1:5274; …`

**بعد:** `electron/main.cjs:328` — أُضيفت `object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`. كل توجيه منها يمنع تحويل مخرجات النموذج إلى برنامج: لا plugin، لا إعادة كتابة `<base>`، لا تأطير أثناء ظهور بطاقة موافقة، لا نموذج يرسل إلى الخارج.

**الاختبار:** `the renderer CSP forbids the directives that turn output into a program`.

---

### P-10 — ملف المفاتيح plaintext يبقى على القرص

**قبل:** `writeFileSync(file, JSON.stringify(plain), 'utf8')` — بلا صلاحيات، ويبقى بعد الإغلاق أو انهيار الوكيل قبل قراءته.

**بعد:**

- `mode: 0o600` عند الكتابة.
- `dropRuntimeKeys()` (`electron/main.cjs:230`) يحذف الملف: قبل كل `spawn` جديد، وعند `window-all-closed`، وعند `before-quit`.

**الاختبار:** `the plaintext key file is deleted, not left on disk` — يثبت وجود التعريف وثلاث استدعاءات على الأقل.

---

### P-11 — نتيجة جديدة: إشارة الإيقاف تُفقد أثناء التهيئة

**كيف ظهرت:** اختبار `two runs keep separate contexts and abort independently` كان يفشل في المجموعة الكاملة ويمر وحده. لم أعتبره «flaky» — تتبّعته.

**السبب:** `server/agent.ts` كان يربط المستمع هكذا:

```ts
opts.abortSignal?.addEventListener('abort', relayAbort)
```

إذا وصل الإيقاف **قبل** هذا السطر (أثناء تحميل الإعداد والقواعد والمهارات)، فالإشارة `aborted` أصلًا، ولن يُطلق حدث `abort` أبدًا → التشغيل يستمر كاملًا ويُطلق `RUN_FINISHED`. أي أن **زر Stop الذي يُضغط في أول ثانية من التشغيل لا يفعل شيئًا**.

**الدليل قبل الإصلاح** (`tmp/probe-abort.ts`، إشارة مُلغاة قبل الاستدعاء):

```
RUN_FINISHED emitted: true
text streamed: 10 chunks
```

**وبعد الإصلاح:**

```
RUN_FINISHED emitted: false
text streamed: 0 chunks
```

وعلى الكود القديم في `backups/pre-remediation/` (`tmp/probe-old.ts`) النتيجة `true` مرة أخرى — أي أن العيب كان موجودًا قبل الإصلاح ولم أُدخله.

**الإصلاح:** `server/agent.ts:1134`

```ts
if (opts.abortSignal?.aborted) localAbort.abort()
```

مع `finally` في `:1496` يزيل المستمع — كان كل محاولة إعادة تترك مستمعًا جديدًا على إشارة الطلب.

**الاختبار:** `a run whose signal is already aborted never streams and never reports finished`.

---

## 4. ما لم يتغيّر (عن قصد)

- **سلوك التطوير الافتراضي محفوظ:** بلا توكن، من نفس الجهاز، كل شيء يعمل كما كان. لم أُغلق الباب على المستخدم، أغلقتُه على الشبكة.
- **`LOONG_HOST` و`LOONG_NO_SANDBOX`** مخرجان صريحان لمن يحتاجهما — القرار مكتوب في بيئة التشغيل، لا مخفي في الكود.
- **لا تغيير في واجهة الـ API** ولا في أشكال الأحداث ولا في صيغة إعداد MCP المقبولة شرعًا.

---

## 5. تقييم T-1 و T-2 — لماذا لم أُصلحهما

### T-1 — إعادة ربط DNS عبر فحص Origin: **نظري، غير قابل للاستغلال كما هو**

**الفرضية:** الخادم يفحص `Origin`، والفحص يحدث بعد تحليل الاسم، فمهاجم يعيد ربط DNS بين الفحص والاستخدام.

**ما وجدته في الكود:** الفحص لا يعتمد على DNS إطلاقًا. `server/index.ts` يقارن `Origin` بقائمة أصول **ثابتة** (`http://localhost:5273`, `http://127.0.0.1:5273`, وأصل `file://`)، ولا يتبع أي عنوان من الـ Origin. لا يوجد «تحليل ثم استخدام» لأن لا شيء يُحلَّل.

**الحكم:** لا مسار استغلال. أُبقي الفحص كما هو، ولم أُضف تعقيدًا لحماية غير موجودة. لو أُضيف لاحقًا أي `fetch` إلى عنوان مشتق من الطلب، تعود الفرضية للحياة ويجب إعادة تقييمها.

### T-2 — حقن أوامر عبر محتوى الصفحات/الأدوات: **نظري، مُخفَّف لا مُغلق**

**الفرضية:** صفحة يجلبها الوكيل تحتوي تعليمات، فينفّذها النموذج كأنها من المستخدم.

**ما فعلته:** P-5 يغلّف كل مخرجات الأدوات في سياج «هذه بيانات لا تعليمات». هذا **يرفع الكلفة ولا يمنع الهجوم** — نموذج لغوي لا يملك حدًّا صارمًا بين البيانات والتعليمات.

**الحكم:** لا يمكن إغلاقه من جهة الخادم وحدها. الإغلاق الحقيقي يحتاج **موافقة بشرية على كل أداة خطرة** (كتابة ملف، shell، MCP) — وهذا موجود جزئيًا في المشروع، لكنه ليس إلزاميًا لكل مسار. أوصي به في §8، ولم أفرضه لأنه يغيّر تجربة الاستخدام تغييرًا جوهريًا ويحتاج قرارك.

---

## 6. الاعتماديات

```cmd
npm audit --omit=dev
```

**النتيجة: `0` ثغرة في 163 حزمة إنتاج** (من أصل 802 في الشجرة كلها). لا شيء يُشحن للمستخدم فيه ثغرة معروفة.

`npm audit` الكامل يعطي **25 ثغرة** — كلها في شجرة التطوير (`electron-builder` → `app-builder-lib` → `@electron/get` → `tar`، و`esbuild`/`vite` في أدوات البناء). هذه لا تدخل الحزمة النهائية، لكنها تعمل على جهازك أثناء البناء. التفصيل:

| الحزمة | الخطورة | الأثر |
|---|---|---|
| `tar` (عبر `@electron/get`) | high | كتابة ملفات عبر hardlink أثناء تنزيل Electron |
| `esbuild` (عبر `vite`) | moderate | خادم تطوير يقرأ أي أصل من الشبكة |
| `@electron/get` وما دونه | moderate | سلسلة التنزيل |

**التوصية:** `npm audit fix` ثم إعادة البناء والتحقق. لم أُشغّلها لأنها ترفع نسخ `electron-builder`/`vite` وقد تكسر البناء — قرار يحتاج تشغيلًا كاملًا لا أستطيع ضمانه الآن.

---

## 7. الأدلة — أين تجدها

| الدليل | الملف |
|---|---|
| اختبارات الإصلاح (23) | `tests/remediation.test.ts` |
| فشل الاختبارات على الكود القديم | `tmp/old-code-proof.log` |
| مسبار P-11 قبل/بعد | `tmp/probe-abort.ts` · `tmp/probe-old.ts` |
| فرق `server/` كاملًا | `tmp/remed-server.diff` |
| فرق `electron/` كاملًا | `tmp/remed-electron.diff` |
| نتيجة المجموعة الكاملة | `tmp/verify-3.log` |
| نتيجة `npm audit` | `tmp/audit.json` · `tmp/audit-prod.json` |
| النسخة الأصلية | `backups/pre-remediation/` |

**الاستعادة الكاملة:**

```cmd
xcopy /E /Y backups\pre-remediation\server server\
xcopy /E /Y backups\pre-remediation\electron electron\
xcopy /E /Y backups\pre-remediation\tests tests\
```

---

## 8. ما تبقّى — مرتّبًا بالأثر

1. **موافقة إلزامية على الأدوات الخطرة (T-2).** كل `shell`/`write_file`/`mcp` يمر ببطاقة موافقة، بلا استثناء وبلا «تذكر اختياري». هذا الإصلاح الوحيد الذي يغلق T-2 فعليًا.
2. **تحديث شجرة التطوير.** `npm audit fix` + إعادة بناء + إعادة تشغيل هذه المجموعة.
3. **`git init` + أول commit.** المشروع بلا مستودع؛ كل ما سبق محفوظ بنسخة مجلد فقط. هذا أكبر خطر تشغيلي الآن.
4. **توقيع الحزمة.** لا توقيع كود على `electron-builder` — المستخدم لا يستطيع التحقق من أن التحديث منه.
5. **حد أقصى لمخرجات الأدوات.** P-5 يغلّف النص لكن لا يحدّ طوله؛ صفحة ضخمة تستهلك السياق كله.

---

## 9. الخلاصة

عشرة من عشرة بنود مُصلحة، وواحد جديد اكتُشف وأُصلح أثناء التحقق، وبندان نظريان قُيّما ولم يُدّعَ إغلاقهما. كل إصلاح له اختبار يفشل على الكود القديم — لا ادعاء بلا دليل، ولا «تم» بلا سطر يمكنك تشغيله.

**لم أُصلح:** T-1 (غير قابل للاستغلال)، T-2 (يحتاج قرارًا في تجربة الاستخدام)، وثغرات شجرة التطوير (تحتاج إعادة بناء).



