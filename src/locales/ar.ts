// locales/ar.ts: Arabic. Same structure as en.ts, mirrored 1:1.
// RTL direction is declared here; the shell flips via [dir] on <html>.
// Typed as Locale: any key missing from (or added to) this file vs en.ts
// becomes a build error instead of a silent runtime gap.
//
// Style rules for editors of this file:
// - Register: plain Modern Standard Arabic, phrased the way Windows and
//   mainstream desktop apps phrase things. Mouse actions are "انقر", never
//   the touch-flavoured "اضغط على".
// - Buttons and menu commands use the verbal noun ("فتح", "حذف", "إعادة
//   المحاولة"), like Windows dialogs. Step-by-step instructions stay imperative.
// - Technical values keep Latin units everywhere, sentences included
//   ("25 MB", "8 GB"). Written-out units ("ميجابايت" / "ميغابايت") split the
//   number from its unit and were spelled two different ways in this file.
// - Any noun that follows a number goes through counted() below, never a
//   bare "N + singular".

import type { Locale } from "./en";

// Arabic counted-noun agreement (MSA): 1 and 2 have dedicated forms, 3-10 take
// the plural, everything else takes the singular accusative (tamyiz). The
// modulo keeps 103 plural and 111 singular, as spoken Arabic does.
function counted(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  const r = n % 100;
  return `${n} ${r >= 3 && r <= 10 ? few : many}`;
}

export const ar: Locale = {
  lang: { code: "ar", dir: "rtl" as "ltr" | "rtl", label: "العربية" },

  // ---- shell / title bar ----
  minimize: "تصغير",
  maximize: "تكبير",
  restore: "استعادة",
  close: "إغلاق",

  // ---- dialog (unified, replaces toasts) ----
  dialog: {
    ok: "موافق",
    cancel: "إلغاء",
    dismiss: "تجاهل",
    delete: "حذف",
    deleteTitle: "حذف هذه الجلسة؟",
    deleteBody: "ستُحذف عيناتها وتقريرها نهائيًا من جهازك.",
    deleteAllTitle: "حذف جميع الجلسات؟",
    deleteAllBody: (n: number) =>
      `ستُحذف جميع الجلسات المحفوظة (${n}) وتقاريرها نهائيًا من جهازك.`,
    scanNeedsGame: "يجب تشغيل اللعبة أولًا لبدء الفحص",
    scanNeedsGameBody:
      "يجب تشغيل لعبة PUBG Mobile داخل GameLoop قبل بدء الفحص. شغّل اللعبة ثم انقر «بدء الفحص» مجددًا.",
    somethingWrong: "حدث خطأ ما",
    /** a novel backend error the code table doesn't know: the locale
        explains, the raw message rides along as a technical line */
    unknownErrorBody: (raw: string) => `حدث خطأ غير متوقع. التفاصيل التقنية: ${raw}`,
    gameloopClosed: "أُغلق GameLoop",
    gameloopClosedBody:
      "أُغلقت اللعبة أثناء الفحص، فأوقفناه وحفظنا التقرير. ابدأ فحصًا جديدًا عندما تعود إلى اللعبة.",
    firstRunAdvice: "للحصول على نتائج دقيقة",
    firstRunAdviceBody:
      "شغّل GameLoop واللعبة أولًا، ثم انقر «بدء الفحص» وابقَ داخل اللعبة طوال مدة الفحص. تصغير نافذة GameLoop يوقف مراقبة كرت الشاشة مؤقتًا، وإغلاقها ينهي الفحص.",
    gameAdviceTitle: "نصيحة قبل أول فحص",
    gameAdviceBody:
      "أغلق التطبيقات التي تعمل في الخلفية قبل اللعب؛ فالمتصفحات والتنزيلات وبرامج المحادثة تنافس اللعبة على المعالج، وقد يظهر أي منها في النتائج كسبب للتقطيع.",
    backgroundAdviceTitle: "ابقَ داخل اللعبة أثناء الفحص",
    backgroundAdviceBody:
      "كانت نافذة اللعبة في الخلفية أثناء هذا الفحص. يتوقف تحليل كرت الشاشة ما دامت النافذة مصغّرة، بينما تستمر بقية القياسات. وللحصول على أكمل النتائج، ابقَ داخل اللعبة حتى ينتهي الفحص.",
    exitTitle: "الخروج قبل الانتهاء؟",
    exitBodyScan: "هناك فحص قيد التشغيل. سيتوقف وسيُحفظ تقريره.",
    exitBodyDownload: "هناك تحديث قيد التنزيل. سيُلغى التنزيل.",
    exitBodyCleaning: "هناك عملية تنظيف قيد التشغيل. ستتوقف.",
    exitConfirm: "خروج",
    emulatorUpdatedTitle: "تم تحديث GameLoop",
    emulatorUpdatedBody: (v: string) =>
      `أصبح GameLoop على الإصدار ${v}. يربط ويندوز إعدادات الرسومات بموقع التثبيت، لذا راجع مفاتيح تبويب الأدوات وأعد تشغيل ما أوقفه التحديث.`,
  },

  // ---- error codes from the backend ----
  errors: {
    GAMELOOP_NOT_RUNNING: "لعبة PUBG Mobile ليست قيد التشغيل داخل GameLoop. شغّلها أولًا.",
    SESSION_ALREADY_RUNNING: "هناك فحص قيد التشغيل بالفعل.",
    SESSION_STOPPING: "لا يزال الفحص السابق قيد الحفظ. حاول مرة أخرى بعد قليل.",
    SESSION_RUNNING: "لا يمكن حذف الفحص الجاري.",
    APP_SHUTTING_DOWN: "التطبيق قيد الإغلاق. حاول مرة أخرى.",
    PF_READ_FAILED: "تعذّرت قراءة إعدادات ملف الترحيل.",
    PF_DRIVE_INVALID: "هذا القرص غير متاح لملف الترحيل.",
    PF_MODE_INVALID: "وضع ملف الترحيل هذا غير صالح.",
    PF_NO_SPACE: "تعذّرت قراءة المساحة الخالية على هذا القرص، ولن نخمّن حدًّا للحجم.",
    PF_INITIAL_INVALID: "الحجم الأولي غير صالح لهذا القرص.",
    PF_MAX_INVALID: "الحجم الأقصى غير صالح لهذا القرص.",
    PF_WRITE_FAILED: "رفض ويندوز تغيير ملف الترحيل.",
    POWERSHELL_TIMEOUT: "استغرق فحص النظام وقتًا طويلًا. حاول مرة أخرى.",
    EMULATOR_UNKNOWN:
      "يبدو أن GameLoop يعمل بإصدار لا تتعرف عليه هذه الأداة بعد. إذا كانت اللعبة قيد التشغيل، فحدّث Lag Hunter إلى أحدث إصدار.",
    PROCESS_NOT_FOUND: "هذا التطبيق مغلق بالفعل، لذا لم يُنهَ أي شيء.",
    PROCESS_ACCESS_DENIED: "رفض ويندوز إنهاء هذا التطبيق. يتطلب ذلك صلاحيات المسؤول.",
    PROCESS_KILL_FAILED: "تعذّر إنهاء هذا التطبيق. حاول مرة أخرى.",
    PROCESS_REFUSED: "هذه العملية محمية ولا يمكن إنهاؤها من هنا أبدًا.",
  } as Record<string, string>,

  // ---- report highlights (composed in the UI from event kinds) ----
  highlights: {
    disk_queue: "القرص تحت ضغط",
    disk_busy: "القرص تحت ضغط",
    hard_faults: "تحميل مكثّف للملفات من القرص",
    cpu_saturation: "المعالج بلغ أقصى طاقته",
    cpu_throttle: "المعالج خفّض سرعته تحت الحمل",
    mem_pressure: "الذاكرة تحت ضغط",
    paging_churn: "نقل ملفات في الخلفية",
    gpu_mem_idle: "كرت الشاشة في وضع توفير الطاقة أثناء رسم الإطارات",
    gpu_activity_cliff: "انخفاض حاد في نشاط كرت الشاشة",
    gpu_activity_cliff_loaded: "انخفاض نشاط كرت الشاشة تحت الحمل",
    gpu_clock_low: "انخفاض تردد كرت الشاشة",
    gpu_temp: "ارتفاع حرارة كرت الشاشة",
    spike: "تباطؤ مستمر في الأداء",
    nothing: "لم يُرصد شيء لافت خلال هذه الجلسة.",
    noSamples: "لم تُسجَّل أي عينات في هذه الجلسة.",
    mostly_background: "كانت اللعبة في الخلفية معظم وقت الجلسة، لذا قد لا تعكس النتائج مباراة حقيقية.",
  } as Record<string, string>,

  // ---- report metrics (composed in the UI from machine keys + numbers) ----
  metrics: {
    cpuPeak: (v: number) => `بلغ استخدام المعالج ذروته عند ${v}% تقريبًا تحت الحمل.`,
    cpuPerfMin: (v: number) => `انخفضت سرعة المعالج في وقت ما إلى ${v}% من سرعته الكاملة.`,
    ramFreeMin: (v: number) => `ظل ما لا يقل عن ${v} MB من الذاكرة خاليًا.`,
    gpuTempMax: (v: number) => `بلغت حرارة كرت الشاشة ${v}\u00B0C في ذروتها.`,
    gpuUsageAvg: (v: number) => `بلغ متوسط استخدام كرت الشاشة ${v}% تقريبًا أثناء الرسم.`,
  } as Record<string, (v: number) => string>,

  menu: "القائمة",
  collapseMenu: "طيّ القائمة",
  expandMenu: "توسيع القائمة",
  monitor: "المراقبة",
  system: "النظام",
  topProcesses: "أثقل العمليات",
  systemHealth: "صحة النظام",
  reports: "التقارير",
  settings: "الإعدادات",
  about: "حول التطبيق",
  language: "اللغة",
  theme: "السمة",
  themeAuto: "تلقائي",
  themeDark: "داكن",
  themeLight: "فاتح",
  zoomTitle: "حجم الواجهة",
  zoomSmall: "صغير",
  zoomDefault: "افتراضي",
  zoomLarge: "كبير",
  /** show-unsupported group (segmented On/Off like language and theme;
      the hint names what revealing does, never which rows: the set is
      engine-decided and grows without copy edits) */
  showUnsupportedTitle: "إظهار الخيارات غير المتاحة",
  showUnsupportedHint:
    "يعرض خيارات الأدوات التي لا يدعمها هذا الجهاز بلون باهت مع ذكر السبب. تبقى مفاتيحها متوقفة لأنه لا يمكن تشغيل أي منها.",
  settingOff: "إيقاف",
  settingOn: "تشغيل",
  // language names in the picker: every user-facing string lives here,
  // including the names of the languages themselves
  langEn: "English",
  langAr: "العربية",
  introResetTitle: "البطاقات التعريفية",
  introResetAction: "إظهار مجددًا",
  introResetHint: "يعيد إظهار كل بطاقة تعريفية أغلقتها بزر X.",
  // small measurement units: GB stays Latin ("16 GB" reads as one technical
  // token). Minutes and seconds use the standard Arabic abbreviations
  // (د / ث) because a lone "m" or "s" looks foreign inside Arabic UI.
  gbUnit: "GB",
  minUnit: "د",
  secUnit: "ث",

  // ---- first-run welcome (three slides, once ever) ----
  welcomeTitle: "PUBG GameLoop Lag Hunter",
  welcomeWhat: "يحلّل أداء PUBG Mobile على GameLoop، ويرصد حالات التقطيع، ويكشف سببها الحقيقي بدقة.",
  /** slide 1: what it finds (titles reuse the short card names) */
  welcomeFindsLabel: "ماذا يكتشف",
  welcomeCardDisk: "ضغط القرص أثناء التحميل",
  welcomeFindDiskDesc: "تتجمد اللعبة أثناء تحميل الملفات",
  welcomeCardCpu: "تشبّع المعالج وخفض سرعته",
  welcomeFindCpuDesc: "لا يستطيع معالجك مجاراة المواجهات الكبيرة",
  welcomeCardGpu: "تباطؤ كرت الشاشة الخفي",
  welcomeFindGpuDesc: "نرصد انخفاضات الطاقة الصامتة ونحدد الإعداد المناسب لإصلاحها",
  welcomeNextBtn: "التالي",
  /** slide 2: how it works, then the sample, then the cost */
  welcomeHowTitle: "انقر «بدء الفحص» ثم العب كالمعتاد",
  welcomeHowSub: "يقيس في الخلفية ويعرض لك السبب مع الحل",
  welcomeSampleLabel: "ما ستراه",
  welcomeBack: "رجوع",
  welcomeSkip: "تخطي",
  /** slide 3: what it costs (values stay Latin in both languages) */
  welcomeTrustTitle: "لا يكاد يستهلك شيئًا من جهازك",
  welcomeCostCpuVal: "<1%",
  welcomeCostCpuLabel: "المعالج أثناء الفحص",
  welcomeCostRamVal: "25 MB",
  welcomeCostRamLabel: "من الذاكرة",
  welcomeCostPrivacyVal: "محلي",
  welcomeCostPrivacyLabel: "التقارير لا تغادر جهازك",
  welcomeBegin: "لنبدأ",

  // ---- system tab ----
  /** one-shot page intro: the page name plus its one-number-per-part
      promise (the cards below deliver it) */
  introSystemTitle: "جهازك بالأرقام",
  introSystemBody: "كل قطعة في جهازك برقمها الأهم.",
  /** scope line under the System tab title: the standing header shows it
      on every visit (loading and error states included); the one-shot
      card below owns the longer promise, so this never repeats it */
  systemScope: "المعالج والذاكرة وبطاقة الرسوميات والتخزين بنظرة واحدة.",
  yourRig: "جهازك",
  storageTitle: "وحدات التخزين",
  deviceSystemTitle: "الجهاز والنظام",
  /** spec card labels */
  specCpu: "المعالج",
  specGpu: "كرت الشاشة",
  specRam: "الذاكرة المثبتة",
  specDisplay: "الشاشة",
  /** spec value labels (label: value lines, MSA-safe for every count) */
  specCores: "الأنوية",
  specThreads: "الخيوط",
  specDedicated: "VRAM مخصصة",
  specSpeedLabel: "السرعة",
  specScaleLabel: "المقياس",
  /** per-disk usage sentence (kind, size, and free share one line) */
  diskFree: (gb: number) => `${Math.round(gb)} GB خالية`,
  diskUsed: (pct: number) => `${Math.round(pct)}% مستخدمة`,
  /** device and system row labels */
  specModel: "الطراز",
  specOs: "ويندوز",
  specDirectx: "DirectX",
  /** copy-all button + its transient confirmation */
  copySpecs: "نسخ كل المواصفات",
  copiedSpecs: "تم النسخ",
  copySpecsFailed: "تعذّر النسخ. حدّد النص ثم انسخه يدويًا.",
  psLimitedTitle: "التطبيق يعمل في وضع محدود",
  psLimitedBody:
    "PowerShell غير متاح، لذا تعمل بعض الفحوصات بإعدادات افتراضية آمنة: يُتخطى ضبط أداء الجهاز، وقد تظهر الأوقات بتوقيت UTC، ويتعطل رصد إيقاف تحليل كرت الشاشة واستئنافه. الفحص نفسه يعمل بشكل طبيعي، والعدّادات الأساسية تُقرأ من ويندوز مباشرةً.",

  // ---- top processes tab ----
  introProcessesTitle: "أغلق التطبيقات الثقيلة قبل اللعب",
  introProcessesBody:
    "هذه هي التطبيقات الأكثر استهلاكًا للذاكرة حاليًا، دون احتساب اللعبة. أغلق ما لا تحتاجه قبل اللعب.",
  /** always-on one-liner above the list (the intro card is one-shot and
      disappears): the action and what the user gets for it, in their
      words. The scope and the ordering live in the intro card and the
      page header, not here */
  procsAbout: "أغلق التطبيقات التي لا تستخدمها لتحرير ذاكرة للعبتك.",
  topProcessesEmpty: "لا يوجد ما يستحق الذكر قيد التشغيل",
  refresh: "تحديث",
  endTask: "إنهاء",
  endingTask: "جارٍ الإنهاء...",
  endConfirmTitle: (name: string) => `إنهاء ${name}؟`,
  endConfirmBody: (name: string) =>
    `سيُغلق ${name} فورًا، وسيضيع أي عمل غير محفوظ فيه.`,
  endConfirmBodyCount: (name: string, count: string) =>
    `سيُغلق ${name} (${count}) فورًا، وسيضيع أي عمل غير محفوظ فيها.`,
  procCount: (n: number) => counted(n, "عملية واحدة", "عمليتان", "عمليات", "عملية"),
  /** per-row RAM line under the app name: the number plus what it is,
      so a bare figure never sits unexplained. At and above a gigabyte
      the figure reads in GB (same threshold as the sweep summary),
      never a four-digit MB count */
  procRamUsage: (mb: number) =>
    mb >= 1024
      ? `استخدام الذاكرة: ${(mb / 1024).toFixed(1)} GB`
      : `استخدام الذاكرة: ${Math.round(mb)} MB`,
  /** curated process display names (stable OS staples only; user
      software names itself via ProductName, raw names back both) */
  procNames: {
    procPowershell: "PowerShell",
    procCmd: "موجه الأوامر",
    procConsoleHost: "مضيف وحدة التحكم",
    procServiceHost: "مضيف الخدمات",
    procCsrss: "وقت تشغيل العميل/الخادم",
    procDwm: "مدير نوافذ سطح المكتب",
    procShellHost: "مضيف بنية واجهة النظام",
    procCtfmon: "مدير الإدخال النصي",
    procExplorer: "مستكشف الملفات",
    procTaskHost: "العملية المضيفة للمهام",
    procRuntimeBroker: "وسيط وقت التشغيل",
    procSearchHost: "مضيف البحث",
    procStartMenu: "قائمة ابدأ",
    procShellExperience: "مضيف تجربة واجهة النظام",
    procSpooler: "التخزين المؤقت للطباعة",
  } as Record<string, string>,
  /** generic loading line for tabs that are not Top Processes */
  loading: "جارٍ التحميل...",
  /** About tab: the manual update check is in flight */
  checkingUpdate: "جارٍ التحقق من وجود تحديثات...",

  // ---- system checks tab ----
  checksHint:
    "أهم إعدادات جهازك في مكان واحد: ما يساعد لعبك وما يبطئه بصمت.",
  introHealthTitle: "ما يبطئ لعبك بصمت",
  introHealthBody:
    "بضعة إعدادات في ويندوز تحدد ما إذا كان اللعب سلسًا أم متقطعًا. وأي إعداد مُعلَّم ينقلك مباشرةً إلى إصلاحه بنقرة واحدة.",
  checkPower: "خطة الطاقة",
  checkPagefile: "الذاكرة الظاهرية (ملف الترحيل)",
  checkCharger: "مصدر الطاقة",
  checkVt: "المحاكاة الافتراضية للمعالج (VT)",
  vtOk: "مفعّلة",
  vtWarn: "معطّلة: فعّلها من BIOS ليعمل المحاكي بسلاسة",
  checkDvr: "التسجيل في الخلفية (DVR)",
  dvrOk: "متوقف",
  dvrWarn: "يعمل: أوقف «تسجيل ما حدث» من إعدادات الألعاب",
  checkOkBadge: "جيد",
  checkWarnBadge: "يحتاج إلى انتباه",
  /** (?) buttons: screen-reader name carries the "about" context so it is
      not announced as a bare duplicate of the row name */
  hintAbout: (name: string) => `معلومات عن ${name}`,
  /** summary banner: one-glance verdict above the cards, derived in the
      UI from the five checks (no backend change — counts warn cards).
      The count is at most 5, so singular / dual / plural covers it. */
  healthAllGood: "كل شيء جيد",
  healthAllGoodSub: "لا يوجد في هذا الجهاز ما يعيق لعبك",
  healthNeedsTitle: (n: number) =>
    n === 1
      ? "إعداد واحد يحتاج إلى انتباه"
      : n === 2
        ? "إعدادان يحتاجان إلى انتباه"
        : `${n} إعدادات تحتاج إلى انتباه`,
  healthNeedsSub: "كل شيء آخر جيد",
  /** header above the full archive list (attention cards repeat above it
      as the featured summary, so this labels what follows, not a filter) */
  healthAllSettings: "كل الإعدادات",
  powerOk: (name: string) => name,
  powerWarn: (name: string) => `${name}: بدّل إلى خطة الأداء العالي لضمان ثبات الإطارات`,
  pagefileAuto: "يديره ويندوز تلقائيًا",
  pagefileManual: (mb: number) => `${(mb / 1024).toFixed(0)} GB ثابت. أي حجم أقل من 8 GB قد يسبب تقطيعًا`,
  pagefileOff: "معطّل، وهذا سبب شائع للتقطيع الشديد",
  chargerOk: "موصول بالشاحن",
  chargerWarn: "يعمل على البطارية: يخفّض الجهاز أداءه وتصبح النتائج غير موثوقة",
  openSettings: "فتح الإعدادات",
  /** health-card button whose fix lives inside Tools (DVR today): same
      promise as openSettings, but the destination is in-app */
  openInTools: "فتح في الأدوات",
  /** per-card background notes behind the (?) button: same contract as the
      Tools hints (plain language, at most 3 sentences, never invented
      numbers). The DVR card reuses the Tools note verbatim (same option,
      same note); the rest own theirs. States and effect timing stay in
      the card's own desc/state lines, never duplicated here. */
  checkPowerHint:
    "تحدد خطة الطاقة ما إذا كان بإمكان المعالج العمل بأقصى سرعته. خطط التوفير تُبطئ المعالج لإطالة عمر البطارية، فيظهر ذلك تقطيعًا في المواجهات.",
  checkPagefileHint:
    "ملف الترحيل ذاكرة احتياطية على القرص تُستخدم عند امتلاء الذاكرة. صغر حجمه أو تعطيله يعني تقطيعًا أثناء تحميل الخرائط وتفاصيلها الرسومية. وترك ويندوز يديره تلقائيًا يناسب معظم الأجهزة.",
  checkVtHint:
    "تتيح المحاكاة الافتراضية لـ GameLoop استخدام معالجك مباشرةً بدل المحاكاة البرمجية البطيئة. ولا يمكن تغيير هذا الإعداد إلا يدويًا من BIOS قبل تشغيل ويندوز.",
  checkChargerHint:
    "تقلّل أجهزة اللابتوب أداءها تلقائيًا عند العمل على البطارية لحمايتها. والفحص في هذه الحالة يقيس جهازًا مقيّد الأداء، فتكون نتائجه مضللة. وصّل الشاحن قبل اللعب أو الفحص.",

  // ---- tools tab ----
  tools: "الأدوات",
  /** beta pill next to the Tools entry in the sidebar: the tab writes to
      Windows and ships before the v2 release, so it stays labelled until
      v2 goes stable */
  toolsBeta: "تجريبية",
  toolsBack: "الأدوات",
  /** scope line under the Tools landing title: what the tab holds at a
      glance (per-card descriptions below own the details, this never
      repeats them) */
  toolsScope: "ضبط ويندوز وتنظيف القرص والذاكرة الظاهرية. كل تغيير يتحقق منه فورًا.",
  toolGamingTweaks: "أداء الألعاب",
  toolGamingTweaksDesc: "مفاتيح أداء لتجربة لعب أكثر سلاسة",
  /** one-shot intro for the gaming section: what the switches do and
      the two row rules (verify live, greyed means unsupported).
      The card takes its own friendly title (the standing header keeps
      the section name, same split as every other page) */
  introGamingTitle: "استعد إطاراتك",
  introGamingBody:
    "كل إعداد في ويندوز يسرق الإطارات له مفتاحه الخاص. التغييرات تُطبق فورًا، والصفوف غير المدعومة تبقى رمادية مع ذكر السبب.",
  toolPagefileDesc: "تقطيع أقل عند امتلاء الذاكرة",
  toolCleanup: "تنظيف القرص",
  toolCleanupDesc: "استعد مساحة القرص دون المساس بأي ملف مهم",
  /** landing status badge over the gaming card (on/shown optimized):
      same rules as the details rows, via the shared summary */
  toolBadgeOptimized: (on: number, total: number) => `${on}/${total} محسّن`,
  toolStorage: "التخزين",
  toolStorageDesc: "تنظيف تلقائي مع فحص يدوي للملفات غير الضرورية.",
  /** one-shot intro for the storage section: who decides and who
      reports (mirrors the gaming intro contract above).
      The card takes its own friendly title (the standing header keeps
      the section name, same split as every other page) */
  introStorageTitle: "حافظ على قرصك مرتبًا",
  introStorageBody:
    "راقب مساحة القرص وحافظ عليها مرتبة، تلقائيًا أو عند الطلب.",

  // ---- tweaks (Tools tab writes — switch mirrors live state).
  // Row copy is the name alone; the definition plus the effect timing
  // live behind the (?) button (same contract as the health cards). */
  tweakDvrTitle: "إيقاف التسجيل في الخلفية (DVR)",
  tweakSsTitle: "تشغيل التنظيف التلقائي",
  tweakGameModeTitle: "تشغيل وضع اللعبة",
  tweakGpuTitle: "تشغيل GameLoop على كرت الشاشة عالي الأداء",
  tweakFsoTitle: "إيقاف تحسينات ملء الشاشة",
  tweakMouseTitle: "إيقاف تسريع الماوس",
  tweakWindowedTitle: "تشغيل تحسينات الألعاب في وضع النافذة",
  /** per-row background notes behind the (?) button: at most 3 sentences,
      plain language (what it does, when it helps or hurts, effect
      timing), never invented numbers. No revert pattern: the switch
      itself is the way back, saying so every time is noise. */
  tweakDvrHint:
    "يحتفظ التسجيل في الخلفية بآخر ثوانٍ من لعبك طوال الوقت، فلا يتوقف ترميز الفيديو ولا الكتابة على القرص أثناء المباراة. إيقافه يزيل استنزافًا دائمًا لموارد كرت الشاشة والقرص دون أي أثر سلبي على اللعب.",
  tweakSsHint:
    "يحذف ويندوز الملفات المؤقتة تلقائيًا عندما تقل المساحة الخالية على القرص. هذا يمنع امتلاء القرص، لكنه لا يحرّر مساحة على قرص ممتلئ بالفعل. وإيقاف الخيار يوقف عمليات التنظيف القادمة.",
  tweakGameModeHint:
    "يطلب من ويندوز منح اللعبة أولوية على المعالج وتأجيل مقاطعات التحديثات أثناء اللعب. تُظهر اختبارات مستقلة لزمن الإطار أنه يخفف الهبوط المفاجئ في الأداء بالدرجة الأولى، خصوصًا على الأجهزة التي تشغّل متصفحًا أو برامج محادثة بجانب اللعبة، وأن بعض الألعاب التي تستهلك المعالج بالكامل تعمل أفضل بدونه. اتركه مفعّلًا ما لم تتقطع لعبة معينة.",
  tweakGpuHint:
    "على أجهزة اللابتوب التي تضم كرتي شاشة، قد يشغّل ويندوز اللعبة على الكرت المدمج الأضعف لتوفير الطاقة. هذا الخيار يثبّت GameLoop على الكرت الأقوى بدلًا من ذلك. ولا يغيّر شيئًا على الأجهزة ذات كرت الشاشة الواحد، وإيقافه يعيد القرار إلى ويندوز.",
  tweakFsoHint:
    "يسوء انتظام إطارات بعض الألعاب تحت معالجة ويندوز لملء الشاشة، وتبدو أكثر سلاسة من دونها. يختلف الأثر من لعبة إلى أخرى، لذا هي تجربة تُجرى لكل لعبة على حدة وليست مكسبًا مضمونًا.",
  tweakMouseHint:
    "تسريع المؤشر يجعله يقطع مسافة أبعد كلما أسرعت بحركة يدك. وإيقافه يجعل الحركة نفسها تعطي المسافة نفسها دائمًا. الأمر متعلق بإحساس التحكم فقط، ولا يغيّر عدد الإطارات.",
  tweakWindowedHint:
    "تستطيع إصدارات ويندوز الحديثة عرض الألعاب في وضع النافذة والنافذة بلا حدود بزمن استجابة أقل عبر مسار عرض أحدث. وتوثّق مايكروسوفت تجربة لعب أكثر سلاسة في هذين الوضعين عند تشغيل هذا الخيار. إيقافه يعيد المسار القديم.",
  tweakPfTitle: "الذاكرة الظاهرية (ملف الترحيل)",
  /** one-shot page card: the why (borrowed disk instead of a crash)
      and the honest default (automatic suits almost everyone) */
  introPagefileTitle: "مساحة احتياطية عند امتلاء الذاكرة",
  introPagefileBody:
    "عند امتلاء الذاكرة، يستعير ويندوز مساحة من القرص لتستمر اللعبة بدلًا من أن تنهار. هذه نسخة من نافذة النظام: لا يتغير إلا القرص الذي تختاره بعد إعادة التشغيل، والوضع التلقائي يناسب معظم المستخدمين.",
  tweakPfAutoLabel: "إدارة حجم ملف الترحيل تلقائيًا لجميع الأقراص",
  tweakPfDrivesLabel: "الأقراص",
  /** short drive-card lines (letter rides its own span, so no drive
      prefix here): free space and mode stay separate spans */
  tweakPfDriveFreeShort: (gb: number) => `${gb} GB خالية`,
  tweakPfDriveNoSpaceShort: "المساحة الخالية غير معروفة",
  tweakPfModeLabel: "الوضع",
  tweakPfModeSystem: "حجم يديره النظام",
  tweakPfModeCustom: "حجم مخصص",
  tweakPfModeOff: "بدون ملف ترحيل",
  tweakPfModeUnknown: "تعذّرت قراءته",
  tweakPfDriveCustom: (min: number, max: number) => `مخصص: ${min}–${max} MB`,
  tweakPfMinLabel: "الحجم الأولي (MB)",
  tweakPfMaxLabel: "الحجم الأقصى (MB)",
  tweakPfApply: "تطبيق",
  /** engine recommendation next to the inputs: values stay Latin */
  pfRecommend: (gb: number, min: number, max: number) =>
    `الحجم الموصى به لذاكرة ${gb} GB: ${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")} MB`,
  tweakPfWarnOffTitle: (drive: string) => `إزالة ملف الترحيل على ${drive}؟`,
  tweakPfWarnOffBody: (drive: string) =>
    `بدون ملف ترحيل على ${drive}، يُرجَّح حدوث انهيارات بسبب نفاد الذاكرة تحت الحمل. يسري التغيير بعد إعادة تشغيل ويندوز.`,
  tweakPfWarnSmallTitle: "حجم صغير لملف الترحيل؟",
  tweakPfWarnSmallBody: (drive: string, max: number) =>
    `الأحجام الأقل من 8 GB سببت تقطيعًا على أجهزة حقيقية. هل تريد تعيين ${max} MB على ${drive} على أي حال؟`,
  tweakPfPending: "أعد تشغيل ويندوز لتطبيق تغيير ملف الترحيل.",
  tweakPfPendingBadge: "يلزم إعادة التشغيل",
  rebootTitle: "إعادة تشغيل ويندوز؟",
  rebootBody:
    "يسري تغيير ملف الترحيل بعد إعادة التشغيل. وإذا أعدت التشغيل الآن، فسيُعاد تشغيل ويندوز فورًا.",
  rebootNow: "إعادة التشغيل",
  rebootLater: "لاحقًا",
  tweakPowerTitle: "تشغيل خطة الأداء العالي",
  /** visible effect timing (shared lines, verified rows only — the
      card shows when, the (?) shows what and why) */
  tweakEffectNow: "يسري فورًا",
  tweakEffectReopen: "أغلق اللعبة وأعد فتحها لتطبيق التغيير",
  tweakEffectSignin: "يسري بعد تسجيل الخروج من ويندوز والدخول مجددًا",
  tweakPowerHint:
    "يشغّل المعالج بكامل سرعته عبر التبديل إلى خطة الأداء العالي. وإذا كانت الخطة غير موجودة، تُستعاد أولًا بأمر ويندوز الرسمي ثم تُفعَّل. إيقافه يعيد الخطة التي كنت تستخدمها، وتخفي الأجهزة المقفلة على وضع «متوازن» فقط هذا الصف.",
  /** summary banner over the gaming rows (same pattern as the health
      tab): one-glance verdict derived from the rendered rows, zero
      backend cost. The count stays small, so singular / dual / plural
      covers it. */
  tweakBannerGood: "كل شيء محسّن",
  tweakBannerGoodSub: "كل خيار على حالته الموصى بها",
  tweakBannerNeeds: (n: number) =>
    n === 1
      ? "خيار واحد يحتاج إلى ضبط"
      : n === 2
        ? "خياران يحتاجان إلى ضبط"
        : `${n} خيارات تحتاج إلى ضبط`,
  tweakBannerNeedsSub: "كل شيء آخر محسّن",
  storageAllTitle: "كل خيارات التخزين",
  /** header above the full archive list (attention rows repeat above it
      as the featured summary, so this labels what follows, not a filter) */
  tweakAllTweaks: "كل الخيارات",
  /** reason line under a greyed-out row whose precondition the user can
      fix (GameLoop exes not resolved) — never shown for rows that can
      never work here (those hide instead) */
  tweakNeedsGameloop: "يتطلب تثبيت GameLoop على هذا الجهاز.",
  tweakNeedsWin11: "يتطلب ويندوز 11 أو أحدث على هذا الجهاز.",
  tweakNeeds1803: "يتطلب ويندوز 10 الإصدار 1803 أو أحدث.",
  tweakHiddenS0: "غير متاح هنا: هذا الجهاز يدعم وضع الاستعداد الحديث (S0) فقط لإدارة الطاقة.",
  tweakHiddenUltimate: "غير متاح هنا: خطة الأداء المطلق (Ultimate Performance) مفعّلة بالفعل.",
  showUnsupportedLink: "إظهار الخيارات غير المتاحة",
  tweakFailed: "تعذّر التحقق من التغيير، لذا لم يُطبَّق.",
  /** storage sweep: scan four safe places, delete only the ticked ones */
  cleanupTitle: "تنظيف الملفات المؤقتة",
  introCleanupTitle: "وحدك تقرر ما يُحذف",
  introCleanupBody:
    "كل ما يظهر هنا بقايا نسيها ويندوز والتطبيقات: ملفات مؤقتة وسجلات قديمة وتقارير منتهية. حدّد ما لم تعد تحتاجه؛ أما الملفات المهمة فلا تُعرض أصلًا.",
  cleanupDesc:
    "يحرّر مساحة على القرص من أماكن آمنة. لا يُحذف إلا ما تحدده، ولا يُمس أي ملف مهم أبدًا.",
  cleanupScan: "فحص",
  cleanupScanning: "جارٍ الفحص...",
  cleanupRescan: "إعادة الفحص",
  cleanupClean: "تنظيف المحدد",
  cleanupCleaning: "جارٍ التنظيف...",
  cleanupSelectAll: "تحديد الكل",
  cleanupDeselectAll: "إلغاء تحديد الكل",
  cleanupNothing: "لا يوجد ما يُنظَّف: جميع الأماكن المفحوصة فارغة بالفعل.",
  cleanupScanFailed: "تعذّرت قراءة بيانات هذا الجهاز أثناء الفحص. حاول مرة أخرى.",
  /** shared legend for the "~" marker on sweep rows (shown once under
      the list, only while a partial row is visible): what the mark
      means and what to do about it. Never invents the hidden remainder. */
  cleanupPartialNote:
    "العلامة ~ تعني أن ويندوز منع قراءة بعض الملفات، فالرقم يحسب ما أمكنت قراءته فقط.",
  cleanupFreed: (mb: number) => `حُرّر ${mb} MB، بحسب القياس قبل التنظيف وبعده.`,
  cleanupUnmeasured:
    "هناك أيضًا مساحة محرَّرة لم يسمح ويندوز بقياسها، لذلك لا تدخل في الرقم أعلاه.",
  /** scanned hero + cleaned payoff labels (the numbers ride their own
      lines, units stay Latin in both languages) */
  cleanupReadyToFree: "جاهزة للتحرير",
  cleanupCleanedTag: "أصبح لقرصك مساحة أرحب الآن.",
  cleanupLastNever: "لم يُنظَّف بعد.",
  cleanupLast: (mb: number, when: string) => `آخر تنظيف: ${mb} MB بتاريخ ${when}.`,
  cleanup30d: (mb: number) => `آخر 30 يومًا: ${mb} MB.`,
  cleanupScanningCat: (name: string) => `جارٍ فحص ${name}...`,
  cleanupCleaningCat: (name: string) => `جارٍ تنظيف ${name}...`,
  cleanupConfirmTitle: "حذف الملفات المحددة؟",
  cleanupConfirmBody: (names: string) =>
    `سيؤدي هذا إلى حذف الملفات المؤقتة نهائيًا من: ${names}. لن يُمسّ إلا ما حددته، وتُتخطى الملفات المستخدمة حاليًا.`,
  cleanupCatUserTemp: "ملفاتي المؤقتة",
  cleanupCatUserTempHint:
    "بقايا خلّفتها تطبيقاتك في مجلدك المؤقت. حذفها آمن، وستعيد التطبيقات بناء ما تحتاجه منها.",
  cleanupCatSystemTemp: "ملفات ويندوز المؤقتة",
  cleanupCatSystemTempHint:
    "بقايا خلّفتها خدمات ويندوز وبرامج التثبيت. حذفها آمن.",
  cleanupCatRecycle: "سلة المحذوفات",
  cleanupCatRecycleHint:
    "ملفات حذفتها بنفسك وما زالت تشغل مساحة. إفراغها نهائي، فراجعها أولًا.",
  cleanupCatDelivery: "ملفات مشاركة التحديثات",
  cleanupCatDeliveryHint:
    "ملفات تحديثات ويندوز التي يحتفظ بها النظام لمشاركتها مع الأجهزة الأخرى على شبكتك. حذفها آمن، وسيعيد ويندوز تنزيل ما يحتاجه.",
  /** opt-in deep scan: same card flips to its results, never auto-ticked */
  cleanupDeepScan: "فحص عميق",
  cleanupModeQuick: "سريع",
  cleanupModeDeep: "عميق",
  cleanupCatThumb: "الصور المصغّرة",
  cleanupCatThumbHint:
    "معاينات صور مخزّنة مؤقتًا يعيد ويندوز بناءها بنفسه. حذفها آمن.",
  cleanupCatReports: "تقارير الأخطاء المنتهية",
  cleanupCatReportsHint:
    "تقارير أخطاء ويندوز القديمة التي أُرسلت أو أُهملت. حذفها آمن.",
  cleanupCatDumps: "ملفات تفريغ الأعطال القديمة",
  cleanupCatDumpsHint:
    "ملفات تفريغ الذاكرة الناتجة عن الأعطال والأقدم من 30 يومًا. أما الحديثة فلا تُمس أبدًا لأنها قد تفسّر عطلًا وقع مؤخرًا.",
  cleanupCatDownload: "بقايا التحديثات",
  cleanupCatDownloadHint:
    "ملفات تحديثات تم تنزيلها ولم يعد ويندوز بحاجة إليها. الأفضل تنفيذه بعد اكتمال التحديثات، وسيعيد ويندوز تنزيل ما يحتاجه.",
  cleanupCatLogs: "سجلات النظام",
  cleanupCatLogsHint:
    "سجلات ويندوز القديمة التي تتراكم بعد التحديثات. ملفات آخر 7 أيام لا تُمس أبدًا.",

  // ---- about tab ----
  aboutTitle: "PUBG GameLoop Lag Hunter",
  aboutWhat: "يحلّل أداء PUBG Mobile على GameLoop، ويرصد حالات التقطيع، ويكشف سببها الحقيقي بدقة.",
  aboutImpact: "ما يستهلكه من جهازك",
  aboutImpactItems: [
    "أقل من 1% من المعالج أثناء الفحص: يقيس فقط ولا ينافس اللعبة",
    "نحو 25 MB من الذاكرة، أقل مما يستهلكه تبويب واحد في المتصفح",
    "نحو 200 KB لكل دقيقة فحص على القرص",
    "تبقى تقاريرك على جهازك",
    "لا يغيّر أي إعداد إلا عندما تبدّل مفتاحه بنفسك",
  ],
  aboutUpdate: "التحديثات",
  aboutCheckUpdate: "التحقق من وجود تحديثات",
  aboutUpToDate: "أنت على أحدث إصدار",
  aboutNewVersion: "يتوفر إصدار جديد. نزّله الآن",
  aboutUpdateErr: "تعذّر التحقق الآن، حاول مرة أخرى لاحقًا",
  aboutSupport: "اشترِ لي قهوة",
  aboutGitHub: "GitHub",
  aboutMade: "صُنع بـ",
  version: "الإصدار",

  // ---- update modal ----
  updateAvailableTitle: "يتوفر إصدار جديد",
  updateDownload: "تنزيل التحديث",
  updateClose: "إغلاق",
  updateCancel: "إلغاء",
  updateDownloading: "جارٍ التنزيل…",
  updateRetry: "إعادة المحاولة",
  updateDoneTitle: "تم تنزيل التحديث",
  updateDoneHint: "أغلق التطبيق وشغّل الملف الجديد عندما تكون جاهزًا.",
  updateOpenFolder: "فتح المجلد",
  updateOk: "تم",
  updateFailedTitle: "فشل التنزيل",
  updateNotesLabel: "ملاحظات الإصدار",
  updateExeFilter: "تطبيق",

  // ---- monitor: controls ----
  autoStop: "إيقاف تلقائي",
  min5: "5 دقائق",
  min10: "10 دقائق",
  min30: "30 دقيقة",
  min60: "60 دقيقة",
  /** fallback for a stored duration outside the four presets */
  minutesShort: (n: number) => counted(n, "دقيقة واحدة", "دقيقتان", "دقائق", "دقيقة"),
  fixLabel: "الحل:",
  /** collapsible event log toggle (Reports shares the same pair) */
  showEventLog: "عرض سجل الأحداث",
  hideEventLog: "إخفاء سجل الأحداث",

  // ---- monitor: idle state (one centered column: the session plan) ----
  scanPlanKicker: "جاهز للفحص",
  // The big number is rendered separately, so the unit only has to agree
  // with it: 3-10 take دقائق, everything else takes دقيقة (5 and 10 read
  // دقائق, 30 and 60 read دقيقة).
  scanPlanUnit: (m: number) => `${m % 100 >= 3 && m % 100 <= 10 ? "دقائق" : "دقيقة"} للجلسة`,
  scanStep1: "ابدأ الفحص",
  scanStep2: "العب كالمعتاد",
  scanStep3: "اقرأ التقرير",
  scanIdleStart: "بدء الفحص",
  scanIdleCloseApps: "أغلق المتصفح والتطبيقات الثقيلة، فالفحص يقيس الجهاز بأكمله.",

  // ---- monitor: running state (the user is away) ----
  scanRunningTitle: "اترك هذه النافذة وابدأ اللعب",
  scanRunningBody: "جارٍ القياس الآن. ستظهر النتيجة عند الانتهاء.",
  // the live doubt this screen settles: "can I minimize this?"
  scanRunningNote:
    "لا حاجة لمراقبة أي شيء. يمكنك تصغير هذه النافذة، فالفحص سيواصل عمله.",
  scanElapsed: "الوقت المنقضي",
  scanRemainingLabel: "الإيقاف التلقائي بعد",
  scanRemaining: (m: number) =>
    m === 1
      ? "دقيقة واحدة متبقية"
      : m === 2
        ? "دقيقتان متبقيتان"
        : `${m} ${m % 100 >= 3 && m % 100 <= 10 ? "دقائق" : "دقيقة"} متبقية`,
  scanSamples: "العينات",
  scanOfSession: "من الجلسة",
  scanMoments: (n: number) => `تم رصد ${counted(n, "لحظة واحدة", "لحظتين", "لحظات", "لحظة")}`,
  scanStop: "إيقاف الفحص",

  // ---- monitor: result state (never auto-dismisses) ----
  scanResultLagTitle: "تم رصد تقطيع",
  scanResultCleanTitle: "لا شيء غير معتاد",
  scanResultOver: (m: number) =>
    `على مدار جلسة مدتها ${counted(m, "دقيقة واحدة", "دقيقتان", "دقائق", "دقيقة")}`,
  scanResultSeconds: "ثانية",
  scanResultMoments: "اللحظات",
  scanResultTopSignal: "أبرز مؤشر",
  scanResultNone: "لا شيء",
  scanResultOpenReport: "فتح التقرير الكامل",
  scanResultAgain: "إعادة الفحص",
  scanResultFootnote: "يحتوي التقرير على الخط الزمني وكل اللحظات وما ينبغي فعله بشأنها.",

  // ---- diagnoses (by engine key, mirrors the backend dictionary) ----
  diagnoses: {
    disk_wait: {
      title: "اللعبة كانت تنتظر القرص",
      simple:
        "توقفت اللعبة أثناء تحميل ملفاتها من القرص، وهذا يسبب تقطيعًا حادًا عند النزول إلى الخريطة وأثناء المواجهات المزدحمة.",
      fix: "زد حجم ملف الترحيل، وخصّص ذاكرة أكبر لـ GameLoop من إعداداته.",
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
      fix: "أغلق التطبيقات التي تعمل في الخلفية، وزد حجم ملف الترحيل.",
    },
    paging_churn: {
      title: "نقل ملفات في الخلفية",
      simple:
        "كان النظام ينقل ملفات اللعبة بين الذاكرة والقرص في الخلفية، رغم أن كليهما كان يعمل بشكل طبيعي. هذا أمر عادي وليس نقصًا في الموارد، لكن كل عملية نقل قد تظهر كتقطيعة بسيطة.",
      fix: "خصّص ذاكرة أكبر لـ GameLoop من إعداداته. وإذا استمرت المشكلة، فزد حجم ملف الترحيل على قرص SSD.",
    },
    gpu_wake: {
      title: "كرت الشاشة يعود من وضع توفير الطاقة",
      simple:
        "انتقل كرت الشاشة إلى وضع توفير الطاقة بين المشاهد واحتاج إلى وقت للعودة إلى أدائه الكامل، فظهر هذا الانتقال كتقطيعة واضحة.",
      fix: "من لوحة تحكم كرت الشاشة (NVIDIA Control Panel)، اضبط إدارة الطاقة لـ GameLoop على «تفضيل الأداء الأقصى»، وأضف جميع عمليات GameLoop وليس اللعبة فقط. وإذا استمرت المشكلة، فقد يكون تعريف كرت الشاشة هو ما يخفّض تردد الذاكرة في المشاهد الخفيفة، وهذا شائع في اللابتوبات ذات كرتي الشاشة؛ وأثره غالبًا تقطيعة عابرة بين المشاهد وليس مشكلة دائمة.",
    },
    scene_hitch: {
      title: "تحميل مشهد لأول مرة",
      simple:
        "عند ظهور مشهد لأول مرة (مثل اللوبي أو خريطة جديدة)، يجهّز الجهاز رسومياته، ما يسبب تقطيعة واحدة بسيطة ثم سلاسة تامة بعدها. وتكون العودة إلى المشهد نفسه سلسة لاحقًا لأنه أصبح مخزَّنًا مؤقتًا.",
      fix: "لا يوجد حل دائم لهذا الأمر؛ فتقلّ حدّته مع تكرار المشاهد، ويتحسن مع تحديث تعريف كرت الشاشة.",
    },
    gpu_busy: {
      title: "كرت الشاشة عند أقصى طاقته",
      simple: "كان كرت الشاشة يعمل بكامل طاقته، ما أدى إلى انخفاض معدل الإطارات.",
      fix: "خفّض دقة اللعبة أو جودة الرسومات بمقدار درجة واحدة.",
    },
  } as Record<string, { title: string; simple: string; fix: string }>,

  // ---- reports ----
  sessions: "الجلسات",
  sessionsHint: "كل فحص مكتمل يُحفظ على جهازك مع تقريره الكامل. انقر على أي جلسة لقراءتها هنا.",
  /** totals card labels (numbers ride their own lines, so no plural
      forms are ever needed) */
  reportTotalSessions: "جلسات",
  reportTotalIssues: "بها مشكلات",
  noSessions: "لا توجد جلسات بعد",
  noSessionsHint: "ابدأ فحصًا من تبويب المراقبة. ستظهر الجلسات المكتملة هنا مع تقاريرها.",
  loadingSessions: "جارٍ تحميل الجلسات...",
  /** deep link to a session id that is no longer saved (deleted meanwhile) */
  reportNotFound: "لم تعد هذه الجلسة محفوظة على هذا الجهاز.",
  allSessions: "كل الجلسات",
  sessionReport: "تقرير الجلسة",
  whatWeFound: "ما وجدناه",
  keyMoments: "اللحظات المهمة",
  theNumbers: "الأرقام",
  noIssuesCaptured: "لم تُرصد أي مشكلات",
  noIssuesCapturedHint: "لا توجد نتائج لافتة في هذه الجلسة. وإذا شعرت بتقطيع رغم ذلك، فشغّل فحصًا أطول أثناء حدوثه.",
  openReportFile: "فتح ملف التقرير",
  openSessionsFolder: "فتح مجلد الجلسات",
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
  spikeCount: (n: number) => counted(n, "تقطيعة واحدة", "تقطيعتان", "تقطيعات", "تقطيعة"),
};
