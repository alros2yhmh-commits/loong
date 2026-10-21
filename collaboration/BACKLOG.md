# BACKLOG — قائمة المهام والأولويات

الأولوية: **الأمان > صحة السلوك > القدرة > الواجهة**.
`Owner` هنا اسم الدور لا شخص آخر — لا يوجد وكيل ثانٍ في هذه الجلسة (انظر `PROTOCOL.md` §0).

| ID | المهمة | الأولوية | Owner | الملفات (ملكية حصرية) | معيار النجاح | الحالة |
|---|---|---|---|---|---|---|
| C-0 | نقطة رجوع Git + فرع معزول | حرج | A | `.gitignore`, `main` | baseline commit قائم، الشجرة نظيفة، `Flow` لم يُمَس | `IMPLEMENTED` |
| C-1 | تغليف قواعد المشروع والمهارات كمحتوى **غير موثوق** + فقرة أسبقية | **حرج (أمن)** | A | `server/rules.ts`, `server/skills.ts`, `server/agent.ts` (SYSTEM_PROMPT فقط), `tests/rules-injection.test.ts` | prompt مُجمَّع يحتوي فاصل عدم-ثقة + مسار المصدر + فقرة أسبقية في الأوضاع الثلاثة؛ وملف `AGENTS.md` خبيث يصمّم نفسه كأمر لا يستطيع إزالة الفاصل | `IN_PROGRESS` |
| C-2 | فشل فحص ما بعد التشغيل يغذّي النموذج بدل إنهاء التشغيل | عالية | A | `server/verify-gate.ts` (جديد), `server/agent.ts`, `tests/verify-gate.test.ts` | فشل + ملفات متغيرة + غير مُجهَض + لم يُجرَّب مرتين ⇒ جولة إصلاح واحدة محدودة؛ النجاح صامت | `PENDING` |
| C-3 | ملخّص المشروع عند أول تلامس | متوسطة | A | `server/digest.ts` (جديد), `server/agent.ts`, `tests/digest.test.ts` | حاقن حتمي مقيّد (لغات، أكبر ملفات، نصوص `package.json`، إشارات git) محدود الطول، معدود في fixture قابل لإعادة الإنتاج | `PENDING` |
| C-4 | وضوح حالة التشغيل والفشل في الواجهة | متوسطة | A | `src/components/ToolCard.tsx`, `src/App.tsx`, `src/components/RunStatus.tsx` (جديد) | فشل أداة يميز بصريًا لا بأيقونة 13px فقط؛ حالة التشغيل مُعلَنة لقارئ الشاشة عبر `aria-live`؛ دليل = لقطتان + `compare_screens` | `PENDING` |
| R-1 | مراجعة مستقلة لكل ما سبق | حرج | **A/B (غير مشغول)** | كل ما سبق | طرف آخر يعيد تشغيل الأوامر ويسجّل النتيجة في `TEST_RESULTS.md` | `BLOCKED — لا وكيل ثانٍ` |

## لا تُعاد

بند مُصلَح موثَّق — إعادة إصلاحه تضييع وقت ومخاطرة انحدار:

- `P-1..P-11` من التقرير الأمني السابق: تقييد الربط بـ loopback، بوابة التوكن، حصر المسارات، تنقية MCP، أعلام Electron، وأزمة إجهاض التشغيل. الدليل: `SECURITY_REMEDIATION_REPORT.md` + `tests/remediation.test.ts` (23 اختبارًا).
- احترام تقليل الحركة: `src/App.tsx:1107` (`MotionConfig reducedMotion="user"`)، 7 مكونات تستخدم `useReducedMotion()`، و`src/styles/global.css:252`. سليم — تحسين C-4 يجب أن يحافظ عليه.
- اقتطاع مخرجات الأدوات وضغط السياق: `server/context.ts:19-25` و`server/context.ts:59-77`. سليم.
