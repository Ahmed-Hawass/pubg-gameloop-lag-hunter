// locales/ar.ts: Arabic. Same structure as en.ts, mirrored 1:1.
// RTL direction is declared here; the shell flips via [dir] on <html>.
// Typed as Locale: any key missing from (or added to) this file vs en.ts
// becomes a build error instead of a silent runtime gap.

import type { Locale } from "./en";

export const ar: Locale = {
  lang: { code: "ar", dir: "rtl" as "ltr" | "rtl", label: "العربية" },

  // ---- shell / title bar ----
  minimize: "تصغير",
  maximize: "تكبير",
  restore: "استعادة",
  close: "إغلاق",

  // ---- dialog (unified, replaces toasts) ----
  dialog: {
    ok: "حسنًا",
    cancel: "إلغاء",
    dismiss: "تجاهل",
    delete: "حذف",
    deleteTitle: "هل تريد حذف هذه الجلسة؟",
    deleteBody: "ستُحذف عيناتها وتقريرها نهائيًا من جهازك.",
    deleteAllTitle: "هل تريد حذف جميع الجلسات؟",
    deleteAllBody: (n: number) =>
      `ستُحذف جميع الجلسات المحفوظة (${n}) وتقاريرها نهائيًا من جهازك.`,
    scanNeedsGame: "يجب تشغيل اللعبة أولًا لبدء الفحص",
    scanNeedsGameBody:
      "يجب أن تكون PUBG Mobile قيد التشغيل داخل GameLoop قبل بدء الفحص. شغّل اللعبة، ثم اضغط زر البدء مرة أخرى.",
    somethingWrong: "حدث خطأ ما",
    /** a novel backend error the code table doesn't know: the locale
        explains, the raw message rides along as a technical line */
    unknownErrorBody: (raw: string) => `حدث خطأ غير متوقع. تفاصيل تقنية: ${raw}`,
    gameloopClosed: "تم إغلاق GameLoop",
    gameloopClosedBody:
      "أُغلقت اللعبة أثناء تشغيل الفحص، فأوقفناه وحفظنا التقرير. ابدأ فحصًا جديدًا عند عودتك إلى اللعبة.",
    firstRunAdvice: "للحصول على نتائج دقيقة",
    firstRunAdviceBody:
      "شغّل GameLoop واللعبة أولًا، ثم اضغط زر البدء، وابقَ داخل اللعبة طوال مدة الفحص. تصغير نافذة GameLoop يوقف مراقبة كرت الشاشة مؤقتًا، وإغلاقها ينهي الفحص تمامًا.",
    gameAdviceTitle: "نصيحة واحدة قبل أول فحص",
    gameAdviceBody:
      "أغلق التطبيقات التي تعمل في الخلفية قبل اللعب؛ فالمتصفحات والتنزيلات وبرامج المحادثة تنافس اللعبة على المعالج، وقد يظهر أي منها في النتائج كسبب للتقطيع.",
    backgroundAdviceTitle: "ابقَ داخل اللعبة أثناء الفحص",
    backgroundAdviceBody:
      "كانت نافذة اللعبة في الخلفية أثناء هذا الفحص. يتوقف تحليل كرت الشاشة ما دامت النافذة مصغّرة، وتستمر بقية القياسات كالمعتاد. وللحصول على نتائج كاملة، ابقَ داخل اللعبة حتى ينتهي الفحص.",
    exitTitle: "الخروج قبل الانتهاء؟",
    exitBodyScan: "يوجد فحص جار. سيتوقف وسيحفظ تقريره.",
    exitBodyDownload: "يوجد تحديث قيد التنزيل. سيلغى التنزيل.",
    exitBodyCleaning: "يوجد تنظيف جار. سيتوقف.",
    exitConfirm: "خروج",
    emulatorUpdatedTitle: "تم تحديث GameLoop",
    emulatorUpdatedBody: (v: string) =>
      `أصبح GameLoop على الإصدار ${v}. يربط ويندوز إعدادات الرسومات بمكان التثبيت، فراجع مفاتيح الأدوات وأعد تفعيل ما أوقفه التحديث.`,
  },

  // ---- error codes from the backend ----
  errors: {
    GAMELOOP_NOT_RUNNING: "PUBG Mobile ليست قيد التشغيل داخل GameLoop. شغّل اللعبة أولًا.",
    SESSION_ALREADY_RUNNING: "هناك فحص قيد التشغيل بالفعل.",
    SESSION_STOPPING: "الفحص السابق لا يزال قيد الحفظ، حاول مرة أخرى بعد قليل.",
    SESSION_RUNNING: "لا يمكن حذف الفحص النشط.",
    SESSION_SAVE_FAILED: "تعذّر حفظ تقرير الجلسة. تحقق من توفر مساحة كافية على القرص، ثم حاول مرة أخرى.",
    APP_SHUTTING_DOWN: "التطبيق يغلق الآن. حاول مرة أخرى.",
    PF_READ_FAILED: "تعذّر قراءة إعدادات page file.",
    PF_DRIVE_INVALID: "هذا القرص غير متاح لـ page file.",
    PF_MODE_INVALID: "وضع page file هذا غير صالح.",
    PF_NO_SPACE: "تعذّر قراءة المساحة الفارغة على هذا القرص، لن نكتب بدون حد.",
    PF_INITIAL_INVALID: "الحجم الأولي غير صالح لهذا القرص.",
    PF_MAX_INVALID: "الحجم الأقصى غير صالح لهذا القرص.",
    PF_WRITE_FAILED: "رفض ويندوز تغيير page file.",
    POWERSHELL_TIMEOUT: "استغرق فحص النظام وقتا طويلا. حاول مرة أخرى.",
    EMULATOR_UNKNOWN:
      "يبدو أن GameLoop يعمل بنسخة لا تعرفها هذه الأداة بعد. إذا كانت اللعبة قيد التشغيل، حدّث Lag Hunter إلى آخر إصدار.",
  } as Record<string, string>,

  // ---- report highlights (composed in the UI from event kinds) ----
  highlights: {
    disk_queue: "ازدحام على القرص",
    disk_busy: "القرص يعمل تحت ضغط",
    hard_faults: "تحميل مكثّف من القرص",
    cpu_saturation: "المعالج وصل إلى أقصى طاقته",
    cpu_throttle: "المعالج خفّض سرعته بسبب الحمل",
    mem_pressure: "الذاكرة تحت ضغط",
    paging_churn: "نقل ملفات في الخلفية",
    gpu_mem_idle: "كرت الشاشة في وضع توفير الطاقة أثناء الرسم",
    gpu_activity_cliff: "انخفاض حاد في نشاط كرت الشاشة",
    gpu_activity_cliff_loaded: "انخفاض في نشاط كرت الشاشة مع حمل عالٍ",
    gpu_clock_low: "تردد كرت الشاشة كان منخفضًا",
    gpu_temp: "ارتفاع حرارة كرت الشاشة",
    spike: "تباطؤ مستمر في الأداء",
    nothing: "لم يحدث ما يستحق الذكر خلال هذه الجلسة.",
    noSamples: "لم تُسجَّل أي عينات في هذه الجلسة.",
    mostly_background: "قُضي معظم وقت هذه الجلسة خارج اللعبة، لذا قد لا تعكس النتائج مباراة حقيقية.",
  } as Record<string, string>,

  // ---- report metrics (composed in the UI from machine keys + numbers) ----
  metrics: {
    cpuPeak: (v: number) => `بلغ المعالج ذروته عند ${v}٪ تقريبًا تحت الحمل.`,
    cpuPerfMin: (v: number) => `انخفض المعالج إلى ${v}٪ من سرعته في بعض اللحظات.`,
    ramFreeMin: (v: number) => `بقي ${v} ميغابايت من الذاكرة متاحة على الأقل.`,
    gpuTempMax: (v: number) => `بلغت حرارة كرت الشاشة ${v}\u00B0C في أشد لحظاتها.`,
    gpuUsageAvg: (v: number) => `كان متوسط استخدام كرت الشاشة ${v}٪ تقريبًا أثناء الرسم.`,
  } as Record<string, (v: number) => string>,

  menu: "القائمة",
  collapseMenu: "طيّ القائمة",
  expandMenu: "توسيع القائمة",
  monitor: "المراقبة",
  system: "النظام",
  topProcesses: "أكثر العمليات استهلاكًا",
  systemHealth: "صحة النظام",
  reports: "التقارير",
  settings: "الإعدادات",
  about: "عن الأداة",
  language: "اللغة",
  theme: "السمة",
  themeAuto: "تلقائي",
  themeDark: "داكن",
  themeLight: "فاتح",
  // language names in the picker: every user-facing string lives here,
  // including the names of the languages themselves
  langEn: "English",
  langAr: "العربية",
  // small measurement units: standalone units are Latin by design ("25 MB"
  // reads as one technical token inside an Arabic sentence; "25 ميجابايت"
  // splits the number from its unit and reads unprofessionally). Full
  // explanatory sentences stay Arabic — the unit keys cover ONLY the
  // standalone measurements, never sentence copy.
  gbUnit: "GB",
  ramUnit: "RAM",
  minUnit: "m",
  secUnit: "s",

  // ---- first-run welcome (two pages, once ever) ----
  welcomeTitle: "PUBG GameLoop Lag Hunter",
  welcomeWhat: "يحلّل هذا التطبيق أداء PUBG Mobile على GameLoop، ويرصد التقطيعات، ويكشف سببها الحقيقي بدقة.",
  welcomeCardDisk: "ازدحام في تحميل القرص",
  welcomeCardCpu: "إشباع المعالج وخفض تردده",
  welcomeCardGpu: "تقطيعات ناتجة عن وضع توفير الطاقة في كرت الشاشة",
  welcomeNext: "بقيت خطوة واحدة",
  welcomeTrustTitle: "استهلاكه من جهازك بسيط جدًا",
  welcomeBegin: "لنبدأ",

  // ---- system tab ----
  yourRig: "جهازك",
  storageTitle: "وحدات التخزين",
  deviceSystemTitle: "الجهاز والنظام",
  /** spec card labels */
  specCpu: "المعالج",
  specGpu: "كرت الشاشة",
  specRam: "الذاكرة",
  specDisplay: "الشاشة",
  /** spec value labels (label: value lines, MSA-safe for every count) */
  specBase: "أساسي",
  specCores: "الأنوية",
  specThreads: "الخيوط",
  specDedicated: "مخصصة",
  specDriver: "درايفر",
  specResolution: "الدقة",
  specRefresh: "التحديث",
  specScale: "مقياس",
  /** device and system row labels */
  specModel: "الموديل",
  specOs: "نظام التشغيل",
  specDirectx: "DirectX",
  /** copy-all button + its transient confirmation */
  copySpecs: "نسخ كل المواصفات",
  copiedSpecs: "تم النسخ",
  copySpecsFailed: "تعذّر النسخ. حدد النص يدويًا.",
  whatWeSee: "ما تستطيع الأداة رؤيته",
  whatWeSeeHint: "هذه هي العدادات التي يقرأها التطبيق فعليًا. أي بيانات غير متاحة تظهر كـ \"--\" بدلًا من أرقام غير دقيقة.",
  seeCpu: "عدادات المعالج والذاكرة والقرص",
  seeGpu: "عدادات كرت الشاشة (NVIDIA)",
  seeGame: "اكتشاف تشغيل PUBG Mobile داخل GameLoop",
  gpuCountersOff: "غير متاح على هذا الجهاز، لذا سيظهر كرت الشاشة كـ \"--\" أثناء الفحص.",
  seePs: "الضبط الدقيق للجهاز (PowerShell)",
  seePsOff: "غير متاح. الفحص يعمل، لكن ضبط الجهاز وتصحيح الساعة سيتم تجاوزهما.",
  psLimitedTitle: "الأداة تعمل في وضع محدود",
  psLimitedBody:
    "PowerShell غير متاح على جهازك، لذا ستعمل بعض الفحوصات على إعدادات افتراضية آمنة: لن يتم ضبط الجهاز على مقاسه، وقد تظهر الأوقات بتوقيت UTC، ويبقى كشف توقف كرت الشاشة معطلًا. الفحص نفسه يعمل بشكل طبيعي، وتُقرأ العدادات الأساسية من ويندوز مباشرة.",

  // ---- top processes tab ----
  topProcessesHint:
    "هذه أكثر العمليات استهلاكًا لموارد جهازك الآن: كل ما يتجاوز 0.5% من المعالج، باستثناء عمليات GameLoop نفسها (فهي اللعبة، ولا تُحتسب ضمن المشتبه بها). أغلق العمليات الثقيلة قبل بدء اللعب.",
  topProcessesEmpty: "لا يوجد شيء ملحوظ يعمل حاليًا",
  topProcessesRefreshing: "جارٍ فحص ما يعمل الآن...",
  refresh: "تحديث",
  /** background totals header: the list below is truncated, these are not */
  totalCpuBackground: "إجمالي المعالج في الخلفية",
  totalRamBackground: "إجمالي الذاكرة في الخلفية",
  /** process groups: user software versus OS-owned tasks */
  groupAppsTitle: "تطبيقات فتحتها",
  groupAppsHint: "آمن إغلاقها قبل اللعب",
  groupSystemTitle: "مهام النظام الخلفية",
  groupSystemHint: "اتركها تعمل",
  /** curated process display names (stable OS staples only; user
      software names itself via ProductName, raw names back both) */
  procNames: {
    procPowershell: "باورشل",
    procCmd: "موجه الأوامر",
    procConsoleHost: "مضيف وحدة التحكم",
    procServiceHost: "مضيف الخدمات",
    procCsrss: "نظام تشغيل العميل",
    procDwm: "مدير نوافذ سطح المكتب",
    procShellHost: "مضيف البنية التحتية",
    procCtfmon: "مدير الإدخال النصي",
    procExplorer: "مستكشف الملفات",
    procTaskHost: "مضيف مهام النظام",
    procRuntimeBroker: "وسيط التشغيل",
    procSearchHost: "البحث",
    procStartMenu: "قائمة ابدأ",
    procShellExperience: "واجهة النظام",
    procSpooler: "التخزين المؤقت للطباعة",
  } as Record<string, string>,
  /** generic loading line for tabs that are not Top Processes */
  loading: "جارٍ التحميل...",
  /** About tab: the manual update check is in flight */
  checkingUpdate: "جارٍ التحقق من وجود تحديث...",

  // ---- system checks tab ----
  checksHint:
    "أهم إعدادات جهازك في مكان واحد: ما يساعد لعبك وما يبطئه بصمت. التفاصيل على بعد ضغطة.",
  checkPower: "خطة الطاقة",
  checkPagefile: "ملف الترحيل (Pagefile)",
  checkCharger: "مصدر الطاقة",
  checkVt: "المحاكاة الافتراضية للمعالج (VT)",
  vtOk: "مفعّلة",
  vtWarn: "معطلة: فعّلها من BIOS لتشغيل سلس للمحاكي",
  checkDvr: "التسجيل في الخلفية (DVR)",
  dvrOk: "مغلق",
  dvrWarn: "يعمل: أغلق تسجيل ما حدث من إعدادات الألعاب",
  checkOkBadge: "جيد",
  checkWarnBadge: "يحتاج إلى انتباه",
  /** summary banner: one-glance verdict above the cards, derived in the
      UI from the five checks (no backend change — counts warn cards).
      Arabic keeps the count as a trailing numeral (بنود...: N) so no
      singular/dual/plural forms are ever needed. */
  healthAllGood: "كل شيء جيد",
  healthAllGoodSub: "لا يوجد في هذا الجهاز ما يعيق لعبك",
  healthNeedsTitle: (n: number) => `بنود تحتاج إلى انتباه: ${n}`,
  healthNeedsSub: "كل شيء آخر جيد",
  /** header above the full archive list (attention cards repeat above it
      as the featured summary, so this labels what follows, not a filter) */
  healthAllSettings: "كل الإعدادات",
  powerOk: (name: string) => name,
  powerWarn: (name: string) => `${name}: بدّلها إلى الأداء العالي لضمان ثبات الإطارات`,
  pagefileAuto: "يديره ويندوز تلقائيًا",
  pagefileManual: (mb: number) => `${(mb / 1024).toFixed(0)} جيجابايت ثابت. أقل من 8 جيجابايت قد يسبب تقطيعًا`,
  pagefileOff: "معطّل، وهذا سبب شائع لحدوث تقطيع شديد",
  chargerOk: "موصول بالشاحن",
  chargerWarn: "يعمل على البطارية، فيخفّض الجهاز أداءه وقد لا تكون النتائج دقيقة",
  openSettings: "افتح الإعداد",
  /** health-card button whose fix lives inside Tools (DVR today): same
      promise as openSettings, but the destination is in-app */
  openInTools: "افتح في الأدوات",
  /** per-card background notes behind the (?) button: same contract as the
      Tools hints (plain language, at most 3 sentences, never invented
      numbers). The DVR card reuses the Tools note verbatim (same option,
      same note); the rest own theirs. States and effect timing stay in
      the card's own desc/state lines, never duplicated here. */
  checkPowerHint:
    "تحدد خطة الطاقة ما إذا كان مسموحًا للمعالج بالعمل بكامل سرعته. خطط التوفير تبطئ المعالج لتوفير البطارية، وهذا يظهر تقطيعًا في المواجهات. الحل مفتاح واحد في إعدادات ويندوز.",
  checkPagefileHint:
    "ملف الترحيل ذاكرة احتياطية على القرص للحظات امتلاء الذاكرة. صغره أو تعطيله يعني تقطيعًا أثناء تحميل الخرائط والقوام. ترك إدارته تلقائيًا لويندوز يناسب معظم الأجهزة.",
  checkVtHint:
    "تتيح المحاكاة الافتراضية لـ GameLoop استخدام معالجك مباشرة بدل المحاكاة البرمجية البطيئة. تغييرها بيدك وحدك من BIOS قبل بدء ويندوز. تفعيل واحد ولا صيانة بعده.",
  checkChargerHint:
    "تُبطئ أجهزة اللابتوب نفسها على البطارية لحمايتها. الفحص على البطارية يقيس جهازًا مخنوقًا فتضلل نتائجه. وصّل الشاحن قبل اللعب أو الفحص.",

  // ---- tools tab ----
  tools: "الأدوات",
  /** beta pill next to the Tools entry in the sidebar: the tab writes to
      Windows and ships before the v2 release, so it stays labelled until
      v2 goes stable */
  toolsBeta: "تجريبية",
  toolsBack: "الأدوات",
  toolGamingTweaks: "تعديلات الألعاب",
  toolGamingTweaksDesc: "كل مفاتيح أداء الألعاب في مكان واحد.",
  /** landing status badge over the gaming card (on/shown optimized):
      same rules as the details rows, via the shared summary */
  toolBadgeOptimized: (on: number, total: number) => `${on}/${total} محسّن`,
  toolStorage: "التخزين",
  toolStorageDesc: "تنظيف تلقائي مع فحص يدوي للملفات المؤقتة.",

  // ---- tweaks (Tools tab writes — switch mirrors live state).
  // Row copy is the name alone; the definition plus the effect timing
  // live behind the (?) button (same contract as the health cards). */
  tweakDvrTitle: "إيقاف التسجيل الخلفي (DVR)",
  tweakSsTitle: "تشغيل التنظيف التلقائي",
  tweakGameModeTitle: "تفعيل وضع الألعاب",
  tweakGpuTitle: "تشغيل GameLoop على كرت الأداء العالي",
  tweakFsoTitle: "إيقاف تحسينات ملء الشاشة",
  tweakMouseTitle: "إيقاف تسريع الماوس",
  tweakWindowedTitle: "تفعيل تحسينات الألعاب النافذة",
  /** per-row background notes behind the (?) button: at most 3 sentences,
      plain language (what it does, when it helps or hurts, effect timing,
      one-tap revert), never invented numbers */
  tweakDvrHint:
    "يُبقي التسجيل الخلفي آخر ثوانٍ من لعبك محفوظة طوال الوقت، فيظل المشفّر والقرص بلا راحة أثناء المباراة. إيقافه يزيل سارقًا دائمًا لكرت الشاشة والقرص دون أي ضرر للعب. إعادة تشغيله ضغطة واحدة إذا افتقدت المقاطع.",
  tweakSsHint:
    "يحذف ويندوز الملفات المؤقتة بنفسه عند اقتراب امتلاء القرص. يمنع امتلاء القرص، لكنه لا يحرر قرصًا ممتلئًا بالفعل. إيقافه يوقف التنظيف المستقبلي بضغطة واحدة.",
  tweakGameModeHint:
    "يطلب من ويندوز إعطاء اللعبة أولوية المعالج وإيقاف مقاطعات التحديث أثناء اللعب. اختبارات مستقلة لزمن الإطارات أظهرت أنه يحسّن أسوأ اللحظات غالبًا على الأجهزة التي تشغّل متصفحًا أو برامج محادثة بجانب اللعبة، وبعض الألعاب المستنزفة للمعالج تعمل أفضل بدونه. اتركه مفعّلًا إلا إذا كانت لعبة معينة تتقطع، والرجوع ضغطة واحدة.",
  tweakGpuHint:
    "على أجهزة اللابتوب ذات كرتي شاشة، قد يشغّل ويندوز اللعبة على الكرت المدمج الأضعف لتوفير الطاقة. هذا يثبّت GameLoop على الكرت القوي بدلًا منه. لا يغيّر شيئًا على الأجهزة ذات الكرت الواحد، وإيقافه يعيد الاختيار لويندوز.",
  tweakFsoHint:
    "بعض الألعاب ينتظم إطاراتها أسوأ تحت معالجة ويندوز لملء الشاشة وتبدو أنعم بدونها. الأثر يختلف من لعبة لأخرى، فهذه تجربة لكل عنوان وليست مكسبًا عامًا. إعادة تشغيلها ضغطة واحدة.",
  tweakMouseHint:
    "تسريع المؤشر يجعل المؤشر يقطع مسافة أبعد كلما أسرعت بحركة يدك. إيقافه يجعل نفس حركة اليد تعطي نفس مسافة المؤشر دائمًا. إحساس خالص لا يغيّر عدد الإطارات، وإعادته ضغطة واحدة.",
  tweakWindowedHint:
    "يستطيع ويندوز الحديث عرض الألعاب النافذة والتي بلا حدود بزمن استجابة أقل عبر مسار أحدث. توثّق مايكروسوفت لعبًا أنعم لهذه الأنماط عند تشغيل المفتاح. إيقافه يعيد المسار القديم بضغطة واحدة.",
  tweakPfTitle: "الذاكرة الظاهرية (page file)",
  tweakPfHint:
    "يطابق مربع حوار الذاكرة الظاهرية في ويندوز: إدارة تلقائية لجميع الأقراص، أو لكل قرص حجم يديره النظام أو مخصص أو بدون page file. يتغير القرص المحدد فقط، وتبقى بقية الأقراص كما هي تمامًا. تُطبق التغييرات بعد إعادة تشغيل ويندوز.",
  tweakPfAutoLabel: "إدارة حجم page file تلقائيًا لجميع الأقراص",
  tweakPfStatusAuto: "تلقائي: ويندوز يدير كل الأقراص",
  tweakPfStatusManual: "يدوي: إعدادات كل قرص أدناه",
  tweakPfDrivesLabel: "الأقراص",
  tweakPfDriveFree: (drive: string, gb: number) => `${drive} · ${gb} جيجابايت فارغة`,
  tweakPfDriveNoSpace: (drive: string) => `${drive} · المساحة الفارغة غير معروفة`,
  /** short drive-card lines (letter rides its own span, so no drive
      prefix here): free space and mode stay separate spans */
  tweakPfDriveFreeShort: (gb: number) => `${gb} جيجابايت فارغة`,
  tweakPfDriveNoSpaceShort: "المساحة الفارغة غير معروفة",
  tweakPfModeLabel: "الوضع",
  tweakPfModeSystem: "حجم يديره النظام",
  tweakPfModeCustom: "حجم مخصص",
  tweakPfModeOff: "بدون page file",
  tweakPfModeUnknown: "غير قابل للقراءة",
  tweakPfDriveCustom: (min: number, max: number) => `مخصص ${min}–${max} ميجابايت`,
  tweakPfMinLabel: "الحجم الأولي (ميجابايت)",
  tweakPfMaxLabel: "الحجم الأقصى (ميجابايت)",
  tweakPfApply: "تطبيق",
  tweakPfWarnOffTitle: (drive: string) => `إزالة page file على ${drive}؟`,
  tweakPfWarnOffBody: (drive: string) =>
    `بدون page file على ${drive}، أعطال نفاد الذاكرة مرجحة تحت الحمل. يُطبق بعد إعادة تشغيل ويندوز.`,
  tweakPfWarnSmallTitle: "page file صغير؟",
  tweakPfWarnSmallBody: (drive: string, max: number) =>
    `الأحجام تحت 8 جيجابايت سببت تقطيعًا على أجهزة حقيقية. تعيين ${max} ميجابايت على ${drive} على أي حال؟`,
  tweakPfPending: "أعد تشغيل ويندوز لتطبيق تغيير page file.",
  tweakPfPendingBadge: "يلزم إعادة التشغيل",
  rebootTitle: "إعادة تشغيل ويندوز؟",
  rebootBody:
    "يسري تغيير page file بعد إعادة التشغيل. الإعادة الآن تعيد تشغيل ويندوز فورًا.",
  rebootNow: "إعادة التشغيل",
  rebootLater: "لاحقًا",
  tweakPowerTitle: "تشغيل الأداء العالي",
  /** visible effect timing (shared lines, verified rows only — the
      card shows when, the (?) shows what and why) */
  tweakEffectNow: "يُطبق فورًا",
  tweakEffectReopen: "أغلق اللعبة وأعد فتحها للتطبيق",
  tweakPowerHint:
    "يضع المعالج على السرعة الكاملة بالتبديل إلى خطة الأداء العالي. لو كانت الخطة مفقودة تُستعاد أولا بأمر ويندوز نفسه ثم تُفعّل. إيقافه يعيد خطتك السابقة، والأجهزة المقفلة على وضع التوازن تخفي هذا الصف.",
  /** summary banner over the gaming rows (same pattern as the health
      tab): one-glance verdict derived from the rendered rows, zero
      backend cost. Arabic keeps the count as a trailing numeral so no
      singular/dual/plural forms are ever needed. */
  tweakBannerGood: "كل شيء مُحسّن",
  tweakBannerGoodSub: "كل خيار على وضعه الموصى به",
  tweakBannerNeeds: (n: number) => `خيارات تحتاج إلى ضبط: ${n}`,
  tweakBannerNeedsSub: "كل شيء آخر محسّن",
  /** header above the full archive list (attention rows repeat above it
      as the featured summary, so this labels what follows, not a filter) */
  tweakAllTweaks: "كل الخيارات",
  /** reason line under a greyed-out row whose precondition the user can
      fix (GameLoop exes not resolved) — never shown for rows that can
      never work here (those hide instead) */
  tweakNeedsGameloop: "يتطلب تثبيت GameLoop على هذا الجهاز.",
  tweakFailed: "تعذّر التحقق من التغيير ولم يُطبَّق.",
  /** storage sweep: scan four safe places, delete only the ticked ones */
  cleanupTitle: "تنظيف الملفات المؤقتة",
  cleanupDesc:
    "يفحص أربعة أماكن آمنة ويحذف فقط ما تحدده. الملفات المستخدمة تُتخطى، والمساحة المحررة مقاسة فعليًا وليست تقديرًا.",
  cleanupScan: "فحص",
  cleanupScanning: "جارٍ الفحص...",
  cleanupRescan: "فحص مجددًا",
  cleanupClean: "تنظيف المحدد",
  cleanupCleaning: "جارٍ التنظيف...",
  cleanupSelectAll: "تحديد الكل",
  cleanupDeselectAll: "إلغاء تحديد الكل",
  cleanupNothing: "لا شيء للتنظيف: كل الأماكن المقاسة فارغة بالفعل.",
  cleanupScanFailed: "تعذّر فحص هذا الجهاز. حاول مجددًا.",
  cleanupFreed: (mb: number) => `تم تحرير ${mb} MB مقاسة قبل التنظيف وبعده.`,
  cleanupUnmeasured:
    "بالإضافة لمساحة محررة منعنا ويندوز من قياسها، فبقيت خارج الرقم أعلاه.",
  cleanupSelected: (mb: number) => `المحدد: ${mb} MB.`,
  cleanupLastNever: "لم يُنظَّف بعد.",
  cleanupLast: (mb: number, when: string) => `آخر تنظيف: ${mb} MB بتاريخ ${when}.`,
  cleanup30d: (mb: number) => `آخر 30 يومًا: ${mb} MB.`,
  cleanupScanningCat: (name: string) => `جارٍ فحص ${name}...`,
  cleanupCleaningCat: (name: string) => `جارٍ تنظيف ${name}...`,
  cleanupConfirmTitle: "حذف الملفات المحددة؟",
  cleanupConfirmBody: (names: string) =>
    `سيحذف هذا نهائيًا الملفات المؤقتة في: ${names}. تُمس الأماكن المحددة فقط، والملفات المستخدمة تُتخطى.`,
  cleanupCatUserTemp: "ملفاتي المؤقتة",
  cleanupCatUserTempHint:
    "بقايا تركتها تطبيقاتك في مجلدك المؤقت. حذفها آمن، والتطبيقات تعيد بناء ما تحتاجه.",
  cleanupCatSystemTemp: "ملفات ويندوز المؤقتة",
  cleanupCatSystemTempHint:
    "بقايا تركتها خدمات ويندوز وبرامج التثبيت. حذفها آمن.",
  cleanupCatRecycle: "سلة المحذوفات",
  cleanupCatRecycleHint:
    "ملفات حذفتها بنفسك وما زالت تشغل مساحة. إفراغها نهائي، راجعها أولًا.",
  cleanupCatDelivery: "كاش مشاركة التحديثات",
  cleanupCatDeliveryHint:
    "ملفات تحديثات ويندوز المحتفظ بها لمشاركتها مع أجهزة شبكتك. حذفها آمن، وويندوز يعيد تنزيل ما يحتاجه.",
  /** opt-in deep scan: same card flips to its results, never auto-ticked */
  cleanupDeepScan: "فحص عميق",
  cleanupModeQuick: "سريع",
  cleanupModeDeep: "عميق",
  cleanupCatThumb: "معاينات الصور المصغرة",
  cleanupCatThumbHint:
    "معاينات صور مخزنة يعيد ويندوز بناؤها بنفسه. حذفها آمن.",
  cleanupCatReports: "تقارير الأخطاء المنتهية",
  cleanupCatReportsHint:
    "تقارير أخطاء ويندوز القديمة المرسلة أو المهملة. حذفها آمن.",
  cleanupCatDumps: "ملفات الأعطال القديمة",
  cleanupCatDumpsHint:
    "ملفات ذاكرة الأعطال الأقدم من 30 يوما. الملفات الحديثة لا تُمس أبدا لأنها قد تفسر عطلا حديثا.",
  cleanupCatDownload: "بقايا التحديثات",
  cleanupCatDownloadHint:
    "ملفات تحديثات نزلت ولم يعد ويندوز يحتاجها. نفذ بعد انتهاء التحديثات، وويندوز يعيد تنزيل ما يلزمه.",
  cleanupCatLogs: "سجلات النظام",
  cleanupCatLogsHint:
    "سجلات ويندوز القديمة المتراكمة بعد التحديثات. ملفات آخر 7 أيام لا تُمس أبدا.",

  // ---- about tab ----
  aboutTitle: "PUBG GameLoop Lag Hunter",
  aboutWhat: "يحلّل هذا التطبيق أداء PUBG Mobile على GameLoop، ويرصد التقطيعات، ويكشف سببها الحقيقي بدقة.",
  aboutImpact: "ما يستهلكه من جهازك",
  aboutImpactItems: [
    "أقل من 1% من المعالج أثناء الفحص: يقيس فقط ولا ينافس اللعبة",
    "نحو 25 ميجابايت من الذاكرة، أقل من تبويب واحد في المتصفح",
    "نحو 200 كيلوبايت في الدقيقة على القرص",
    "تتوقف كل جلسة تلقائيًا، فلا يبقى شيء يعمل دون علمك",
    "لا يغيّر أي إعداد إلا عندما تقلب مفتاحه بنفسك",
  ],
  aboutUpdate: "التحديثات",
  aboutCheckUpdate: "تحقق من وجود تحديث",
  aboutUpToDate: "أنت على أحدث إصدار",
  aboutNewVersion: "يتوفر إصدار جديد، قم بتنزيله",
  aboutUpdateErr: "تعذّر التحقق الآن، حاول مرة أخرى لاحقًا",
  aboutSupport: "اشترِ لي قهوة",
  aboutMade: "صُنع باستخدام",
  version: "الإصدار",

  // ---- update modal ----
  updateAvailableTitle: "يتوفر إصدار جديد",
  updateDownload: "تحديث",
  updateClose: "إغلاق",
  updateCancel: "إلغاء",
  updateDownloading: "جارٍ التنزيل…",
  updateRetry: "أعد المحاولة",
  updateDoneTitle: "تم تنزيل التحديث",
  updateDoneHint: "أغلق الأداة وشغّل الملف الجديد متى ما كنت مستعدًا.",
  updateOpenFolder: "افتح المجلد",
  updateOk: "تمام",
  updateFailedTitle: "فشل التنزيل",
  updateNotesLabel: "ملاحظات الإصدار",

  // ---- monitor: controls ----
  startScanning: "ابدأ",
  stop: "إيقاف",
  autoStop: "إيقاف تلقائي",
  min5: "5 دقائق",
  min10: "10 دقائق",
  min30: "30 دقيقة",
  min60: "60 دقيقة",
  /** fallback for a stored duration outside the four presets */
  minutesShort: (n: number) => `${n} دقيقة`,
  time: "الوقت",
  timelineHint: "كل نقطة حمراء تمثل تقطيعة تم رصدها. يمتلئ الشريط كلما اقترب موعد الإيقاف التلقائي.",
  timelineAutoStop: "الإيقاف التلقائي",
  timelineDuration: "مدة الجلسة",
  fixLabel: "الحل:",

  // ---- monitor: hero states ----
  spikesCaptured: (n: number) => `تم رصد ${n === 1 ? "تقطيعة واحدة" : `${n} تقطيعات`}`,
  sessionClean: "كانت الجلسة سليمة دون أي تقطيع",

  // ---- monitor: metrics ----
  cpu: "المعالج",
  ram: "الذاكرة",
  gpu: "كرت الشاشة",
  disk: "القرص",
  cpuHint:
    "نسبة استخدام المعالج. من الطبيعي أن ترتفع أثناء تشغيل GameLoop للعبة، أما استمرارها فوق 95% مع حدوث تقطيع فهذا يعني أن المعالج غير كافٍ.",
  ramHint:
    "الذاكرة المستخدمة حاليًا. عند امتلائها، تبدأ اللعبة بنقل الملفات إلى القرص، وكل عملية نقل تسبب تقطيعًا.",
  gpuHint:
    "نسبة استخدام كرت الشاشة أثناء الرسم. قد تشير القيم المنخفضة أثناء المباراة إلى تقطيع ناتج عن وضع توفير الطاقة.",
  diskHint:
    "نشاط القرص. من الطبيعي أن يرتفع أثناء النزول إلى الخريطة، أما استمراره عند 100% مع حدوث تقطيع فهذا يعني ازدحامًا حقيقيًا في التحميل.",

  // ---- monitor: activity feed ----
  activity: "النشاط",
  activityHint:
    "كل ما ترصده الأداة أثناء اللعب، مرتّبًا من الأحدث إلى الأقدم. عند شعورك بأي تقطيع، راجع هذا القسم: سيوضّح لك ما حدث.",
  nothingUnusual: "لا شيء غير معتاد حتى الآن، وهذا جيد.",
  waitingGameloopFeed: "في انتظار بدء تشغيل PUBG Mobile...",
  /** idle guidance panel (empty state before the first scan) */
  idleGuideTitle: "اضغط زر البدء ثم العب كالمعتاد",
  idleGuideHint:
    "يُقاس المعالج والذاكرة وكرت الشاشة والقرص كل ثانية أثناء اللعب، وأي تقطيع يظهر هنا مشروحًا مع حله.",
  /** collapsible event log toggle */
  showEventLog: "عرض سجل الأحداث",
  hideEventLog: "إخفاء سجل الأحداث",

  // feed lines (by engine event kind)
  feed: {
    disk_queue: "ازدحام على القرص",
    disk_busy: "القرص يعمل تحت ضغط",
    hard_faults: "تحميل مكثّف من القرص",
    cpu_saturation: "المعالج وصل إلى أقصى طاقته",
    cpu_throttle: "المعالج خفّض سرعته بسبب الحمل",
    mem_pressure: "الذاكرة تحت ضغط",
    paging_churn: "نقل ملفات في الخلفية",
    gpu_mem_idle: "كرت الشاشة في وضع توفير الطاقة أثناء الرسم",
    gpu_activity_cliff: "انخفاض حاد في نشاط كرت الشاشة",
    gpu_activity_cliff_loaded: "انخفاض في نشاط كرت الشاشة مع حمل عالٍ",
    gpu_clock_low: "تردد كرت الشاشة منخفض",
    gpu_temp: "ارتفاع حرارة كرت الشاشة",
    spike: "تباطؤ مستمر في الأداء",
  } as Record<string, string>,

  // ---- monitor: summary ----
  openReportBtn: "افتح التقرير الكامل",
  summaryHint: (n: number) => `تم تسجيل ${n} عينة. افتح التقرير لمعرفة ما حدث.`,

  // ---- diagnoses (by engine key, mirrors the backend dictionary) ----
  diagnoses: {
    disk_wait: {
      title: "اللعبة كانت تنتظر القرص",
      simple: "توقفت اللعبة أثناء تحميل ملفاتها من القرص، وهذا يسبب تقطيعًا حادًا عند النزول إلى الخريطة وأثناء المعارك المزدحمة.",
      fix: "زد حجم ملف الترحيل (Pagefile)، وخصّص لـ GameLoop ذاكرة أكبر من إعداداته.",
    },
    cpu_busy: {
      title: "المعالج عند أقصى طاقته",
      simple: "كان المعالج يعمل بكامل طاقته، إذ احتاجت اللعبة إلى أنوية معالجة أكثر من المتاح.",
      fix: "اجعل GameLoop يستخدم الأنوية الفعلية فقط، وأغلق التطبيقات التي تعمل في الخلفية (المتصفح، Discord) قبل بدء اللعب.",
    },
    cpu_throttle: {
      title: "المعالج يخفّض سرعته",
      simple: "ارتفعت حرارة المعالج فخفّض سرعته لحماية نفسه، ما أدى إلى تراجع ملحوظ في الأداء تحت الحمل.",
      fix: "نظّف مراوح التبريد، واستخدم قاعدة تبريد، واحرص على إبقاء الشاحن موصولًا.",
    },
    mem_low: {
      title: "الذاكرة أوشكت على الامتلاء",
      simple: "امتلأت الذاكرة، فبدأت اللعبة تنقل الملفات بين الذاكرة والقرص باستمرار، وكل عملية نقل تسبب تقطيعًا.",
      fix: "أغلق التطبيقات التي تعمل في الخلفية، وزد حجم ملف الترحيل (Pagefile).",
    },
    paging_churn: {
      title: "نقل ملفات في الخلفية",
      simple:
        "كان النظام ينقل ملفات اللعبة بين الذاكرة والقرص في الخلفية، رغم أن كليهما كان يعمل بشكل طبيعي. هذا أمر عادي وليس نقصًا في الموارد، لكن كل نقلة قد تظهر كتقطيعة بسيطة.",
      fix: "خصّص لـ GameLoop ذاكرة أكبر من إعداداته. إذا استمرت المشكلة، زد حجم ملف الترحيل (Pagefile) على قرص SSD.",
    },
    gpu_wake: {
      title: "كرت الشاشة يعود من وضع توفير الطاقة",
      simple:
        "ينتقل كرت الشاشة إلى وضع توفير الطاقة بين المشاهد، ويحتاج إلى وقت للعودة إلى أدائه الكامل، ويظهر هذا الانتقال كتقطيع واضح.",
      fix: "من لوحة تحكم كرت الشاشة (NVIDIA Control Panel)، اجعل إدارة الطاقة \"تفضيل الأداء الأقصى\" لـ GameLoop، وأضف جميع عمليات GameLoop وليس اللعبة فقط. إن استمرت المشكلة، فقد يكون سبب ذلك تعريف كرت الشاشة الذي يخفّض تردد الذاكرة في المشاهد الخفيفة، وهو أمر شائع في الأجهزة المحمولة ذات كرتي الشاشة، وأثره غالبًا تقطيعة عابرة بين المشاهد وليس مشكلة دائمة.",
    },
    scene_hitch: {
      title: "تحميل مشهد لأول مرة",
      simple:
        "عند ظهور مشهد لأول مرة (كالصالة الرئيسية أو خريطة جديدة)، يجهّز الجهاز رسومياته، ما يسبب تقطيعة واحدة بسيطة ثم سلاسة تامة بعدها. وتكون العودة إلى المشهد نفسه سلسة لاحقًا لأنه أصبح مخزَّنًا مؤقتًا.",
      fix: "لا يوجد حل دائم لهذا الأمر، إذ تقلّ حدّته مع تكرار المشاهد، ويتحسن مع تحديث تعريف كرت الشاشة.",
    },
    gpu_busy: {
      title: "كرت الشاشة عند أقصى طاقته",
      simple: "كان كرت الشاشة يعمل بكامل طاقته، ما أدى إلى انخفاض معدل الإطارات.",
      fix: "خفّض دقة اللعبة أو جودة الرسومات بمقدار درجة واحدة.",
    },
  } as Record<string, { title: string; simple: string; fix: string }>,

  // ---- reports ----
  sessions: "الجلسات",
  sessionsHint: "كل فحص مكتمل يُحفظ على جهازك مع تقريره الكامل. اضغط على أي جلسة لقراءتها هنا.",
  noSessions: "لا توجد جلسات بعد",
  noSessionsHint: "شغّل فحصًا من تبويب المراقبة. ستظهر الجلسات المكتملة هنا مع تقاريرها.",
  loadingSessions: "جارٍ تحميل الجلسات...",
  /** deep link to a session id that is no longer saved (deleted meanwhile) */
  reportNotFound: "هذه الجلسة لم تعد محفوظة على هذا الجهاز.",
  allSessions: "كل الجلسات",
  sessionReport: "تقرير الجلسة",
  whatWeFound: "ما وجدناه",
  keyMoments: "اللحظات المهمة",
  theNumbers: "الأرقام",
  noIssuesCaptured: "لم تُرصد أي مشكلات",
  noIssuesCapturedHint: "لم تتضمن هذه الجلسة نتائج تستحق الذكر. إن شعرت بتقطيع رغم ذلك، شغّل فحصًا أطول وقت حدوثه.",
  openReportFile: "افتح ملف التقرير",
  openSessionsFolder: "افتح مجلد الجلسات",
  deleteSession: "حذف الجلسة",
  deleteAllSessions: "حذف الكل",
  // honest outcomes
  clean: "سليمة",
  findings: "نتائج",
  lagCaptured: "تم رصد تقطيع",
  partial: "غير مكتملة",
  samples: "عينة",
  // MSA counting: 1 = singular, 2 = dual, 3-10 = plural, 11+ = singular
  // again ("11 تقطيعة") — the bare-plural-for-everything shape reads wrong
  spikeCount: (n: number) =>
    n === 1
      ? "تقطيعة واحدة"
      : n === 2
        ? "تقطيعتان"
        : n >= 3 && n <= 10
          ? `${n} تقطيعات`
          : `${n} تقطيعة`,
};
