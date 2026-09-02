// locales/ar.ts — Arabic. Same structure as en.ts, mirrored 1:1.
// RTL direction is declared here; the shell flips via [dir] on <html>.

export const ar = {
  lang: { code: "ar", dir: "rtl" as const, label: "العربية" },

  // ---- sidebar / shell ----
  // ---- shell / title bar ----
  minimize: "تصغير",
  maximize: "تكبير (حجم النافذة ثابت)",
  close: "إغلاق",
  whatDoTheseMean: "ما معنى هذه القيم؟",

  // ---- dialog (unified — replaces toasts) ----
  dialog: {
    ok: "حسنًا",
    cancel: "إلغاء",
    confirm: "تأكيد",
    delete: "حذف",
    deleteTitle: "حذف هذه الجلسة؟",
    deleteBody: "ستُحذف عيناتها وتقريرها نهائيًا من جهازك.",
    scanNeedsGame: "يلزم تشغيل اللعبة لبدء الفحص",
    scanNeedsGameBody:
      "يجب أن تكون PUBG Mobile تعمل داخل GameLoop قبل بدء الفحص. ابدأ اللعبة ثم اضغط ابدأ الفحص مرة أخرى.",
    somethingWrong: "حدث خطأ ما",
    gameloopClosed: "تم إغلاق GameLoop",
    gameloopClosedBody:
      "أُغلقت اللعبة أثناء تشغيل الفحص، لذا أوقفناه وحفظنا التقرير. ابدأ فحصًا جديدًا عندما تعود إلى اللعبة.",
    firstRunAdvice: "للحصول على نتائج دقيقة",
    firstRunAdviceBody:
      "شغّل GameLoop واللعبة أولًا ثم اضغط ابدأ — وابقَ داخل اللعبة أثناء الفحص. تصغير GameLoop يوقف مراقبة كرت الشاشة مؤقتًا، وإغلاقه ينهي الفحص.",
  },

  // ---- error codes from the backend ----
  errors: {
    GAMELOOP_NOT_RUNNING: "PUBG Mobile ليست تعمل داخل GameLoop. ابدأ اللعبة أولًا.",
    SESSION_ALREADY_RUNNING: "هناك فحص يعمل بالفعل.",
    SESSION_STOPPING: "لا يزال الفحص السابق قيد الحفظ — حاول بعد لحظات.",
    SESSION_SAVE_FAILED: "تعذر حفظ تقرير الجلسة. تحقق من المساحة المتاحة على القرص ثم حاول مجددًا.",
  } as Record<string, string>,

  // ---- report highlights (composed in the UI from event kinds) ----
  highlights: {
    disk_queue: "ازدحام على القرص",
    disk_busy: "القرص تحت ضغط",
    hard_faults: "تحميل مكثف من القرص",
    cpu_saturation: "وصل المعالج إلى حدّه الأقصى",
    cpu_throttle: "المعالج خفّض سرعته تحت الحمل",
    mem_pressure: "ضغط على الذاكرة",
    gpu_mem_idle: "كرت الشاشة في وضع التوفير أثناء الرسم",
    render_stall: "تم رصد تجميد للإطارات",
    render_stall_loaded: "تجميد للإطارات تحت الحمل",
    gpu_clock_low: "كان تردد كرت الشاشة منخفضًا",
    gpu_temp: "ارتفاع حرارة كرت الشاشة",
    spike: "تباطؤ مستمر في الأداء",
    nothing: "لم يحدث شيء يستحق الذكر خلال الجلسة.",
    noSamples: "لم تُؤخذ عينات في هذه الجلسة.",
    mostly_background: "قضيت معظم هذه الجلسة خارج اللعبة — النتائج قد لا تعكس ماتشًا حقيقيًا.",
  } as Record<string, string>,

  menu: "القائمة",
  collapseMenu: "طي القائمة",
  expandMenu: "توسيع القائمة",
  monitor: "المراقبة",
  system: "النظام",
  topProcesses: "أكثر العمليات استهلاكًا",
  systemChecks: "فحوصات النظام",
  reports: "التقارير",
  settings: "الإعدادات",
  about: "عن الأداة",
  language: "اللغة",

  // ---- first-run welcome (two pages, once ever) ----
  welcomeTitle: "PUBG GameLoop Lag Hunter",
  welcomeWhat: "نراقب جهازك أثناء لعب PUBG Mobile على GameLoop، ونرصد كل تقطيع، ونخبرك بسببه — بكلمات واضحة.",
  welcomeCardDisk: "عواصف تحميل القرص",
  welcomeCardCpu: "إشباع المعالج وخفض التردد",
  welcomeCardGpu: "تقطيعات حالة الطاقة لكرت الشاشة",
  welcomeNext: "بقيت نقطة واحدة",
  welcomeTrustTitle: "تكلفك القليل جدًا",
  welcomeBegin: "هيا نبدأ",

  // ---- system tab ----
  yourRig: "جهازك",
  whatWeSee: "ما تستطيع الأداة رؤيته",
  whatWeSeeHint: "العدادات التي يقرأها المحرك فعليًا. أي مصدر غير متاح يظهر كـ \"--\" بدلًا من أرقام خاطئة.",
  seeCpu: "عدادات المعالج / الذاكرة / القرص",
  seeGpu: "عدادات كرت الشاشة (NVIDIA)",
  seeGame: "اكتشاف PUBG Mobile (GameLoop)",
  gpuCountersOff: "غير متاح على هذا الجهاز — كرت الشاشة يظهر \"--\" أثناء الفحص.",

  // ---- top processes tab ----
  topProcessesHint: "العمليات الأكثر استهلاكًا لموارد جهازك الآن — كل ما يتجاوز 0.5% من المعالج، باستثناء عمليات GameLoop (لأنها اللعبة نفسها ولا تُحتسب ضمن العمليات المشتبه بها). أغلق العمليات الثقيلة قبل بدء اللعب.",
  topProcessesEmpty: "لا شيء مهم يعمل حاليًا",
  topProcessesRefreshing: "جارٍ فحص ما يعمل...",
  refresh: "تحديث",

  // ---- system checks tab ----
  checksHint: "فحوصات قراءة فقط لإعدادات تسبب التقطيع بصمت. لا نغيّر شيئًا عنك — كل إصلاح يفتح صفحة ويندوز المطلوبة لتغيّرها بنفسك.",
  checkPower: "مخطط الطاقة",
  checkPagefile: "ملف الصفحات",
  checkCharger: "مصدر الطاقة",
  powerOk: (name: string) => `${name} — جيد`,
  powerWarn: (name: string) => `${name} — بدّل إلى الأداء العالي لثبات الفريمات`,
  pagefileAuto: "يديره ويندوز — جيد",
  pagefileManual: (mb: number) => `${(mb / 1024).toFixed(0)} GB ثابت — أقل من 8 GB قد يسبب تقطيعًا`,
  pagefileOff: "معطّل — سبب كلاسيكي لتقطيع حاد",
  chargerOk: "موصل بالشاحن",
  chargerWarn: "على البطارية — الجهاز يبطئ والنتائج تصبح غير موثوقة",
  openSettings: "افتح الإعداد",

  // ---- about tab ----
  aboutTitle: "PUBG GameLoop Lag Hunter",
  aboutWhat: "أداة ويندوز تراقب جهازك أثناء لعب PUBG Mobile على GameLoop، تلتقط كل تقطيعة، وتخبرك بسببها وطريقة إصلاحه.",
  aboutImpact: "ما تستهلكه من جهازك",
  aboutImpactItems: [
    "أقل من 1% من المعالج أثناء الفحص — تقيس ولا تنافس",
    "~25 ميجابايت من الذاكرة — أقل من تبويب متصفح واحد",
    "~200 كيلوبايت في الدقيقة على القرص",
    "كل جلسة تتوقف تلقائيًا — لا شيء يعمل منسيًا",
    "لا تعدّل إعدادات ويندوز أبدًا",
  ],
  aboutUpdate: "التحديثات",
  aboutCheckUpdate: "تحقق عن تحديثات",
  aboutUpToDate: "أنت على أحدث إصدار",
  aboutNewVersion: "يتوفر إصدار جديد — نزّله",
  aboutUpdateErr: "تعذر التحقق الآن — حاول لاحقًا",
  aboutSupport: "اشترِ لي قهوة",
  aboutMade: "صُنع بـ",
  version: "الإصدار",

  // ---- monitor: controls ----
  startScanning: "ابدأ",
  stop: "أوقف",
  autoStop: "إيقاف تلقائي",
  min5: "5 دقائق",
  min10: "10 دقائق",
  min30: "30 دقيقة",
  min60: "60 دقيقة",
  hour2: "ساعتان",
  time: "الوقت",
  metricsHint:
    "استخدام المعالج. الارتفاع طبيعي أثناء ترجمة GameLoop للعبة. الاستمرار فوق 95% مع تقطيع يعني أن المعالج غير كافٍ.",
  timelineHint: "كل نقطة حمراء هي تقطيعة سجلناها. يزداد الشريط مع اقتراب وقت الإيقاف التلقائي.",

  // ---- monitor: hero states ----
  spikesCaptured: (n: number) => (n > 1 ? `تم رصد ${n} تقطيعات` : "تم رصد تقطيعة واحدة"),
  sessionClean: "كانت الجلسة سليمة",

  // ---- monitor: metrics ----
  cpu: "المعالج",
  ram: "الذاكرة",
  gpu: "كرت الشاشة",
  disk: "القرص",

  // ---- monitor: activity feed ----
  activity: "النشاط",
  activityHint: "كل ما ترصده الأداة أثناء اللعب، مرتبًا من الأحدث. عند الإحساس بأي تقطيع، راجع هذا القسم — سيوضح ما حدث.",
  nothingUnusual: "لا شيء غير طبيعي حتى الآن — وهذا جيد.",
  waitingGameloopFeed: "في انتظار بدء PUBG Mobile...",
  gameBackground: "نافذة اللعبة في الخلفية — مراقبة كرت الشاشة متوقفة حتى تعود",

  // feed lines (by engine event kind)
  feed: {
    disk_queue: "ازدحام على القرص",
    disk_busy: "القرص تحت ضغط",
    hard_faults: "تحميل مكثف من القرص",
    cpu_saturation: "وصل المعالج إلى حدّه الأقصى",
    cpu_throttle: "المعالج خفّض سرعته تحت الحمل",
    mem_pressure: "ضغط على الذاكرة",
    gpu_mem_idle: "كرت الشاشة في وضع التوفير أثناء الرسم",
    render_stall: "تم رصد تجميد للإطارات",
    render_stall_loaded: "تجميد للإطارات تحت الحمل",
    gpu_clock_low: "تردد كرت الشاشة منخفض",
    gpu_temp: "ارتفاع حرارة كرت الشاشة",
    spike: "تباطؤ مستمر في الأداء",
  } as Record<string, string>,

  // ---- monitor: empty states ----

  // ---- monitor: summary ----
  openReportBtn: "افتح التقرير الكامل",
  summaryHint: (n: number) => `تم أخذ ${n} عينة. افتح التقرير لمعرفة ما حدث.`,

  // ---- diagnoses ----
  diagnoses: {
    disk_wait: {
      title: "اللعبة كانت تنتظر القرص",
      simple: "توقفت اللعبة أثناء تحميل ملفاتها من القرص — وهو ما يسبب تقطيعًا حادًا أثناء النزول إلى الخريطة وفي المعارك المزدحمة.",
      fix: "زد حجم ملف ترقيم الصفحات (Pagefile) وخصص لـ GameLoop ذاكرة أكبر من إعداداته.",
    },
    cpu_busy: {
      title: "المعالج عند حدّه الأقصى",
      simple: "عمل المعالج بكامل طاقته — احتاجت اللعبة إلى أنوية معالجة أكثر من المتاح.",
      fix: "خصص أنوية GameLoop بالأنوية الفعلية فقط، وأغلق التطبيقات الخلفية (المتصفح، Discord) قبل بدء اللعب.",
    },
    cpu_throttle: {
      title: "المعالج يبطئ نفسه",
      simple: "ارتفعت حرارة المعالج فخفّض سرعته لحماية نفسه — تراجع الأداء بشكل حاد تحت الحمل.",
      fix: "نظّف مراوح التبريد، واستخدم قاعدة تبريد، مع إبقاء الشاحن موصولًا.",
    },
    mem_low: {
      title: "الذاكرة أوشكت على الامتلاء",
      simple: "امتلأت الذاكرة وأخذت اللعبة في نقل الملفات بين الذاكرة والقرص باستمرار — وكل عملية نقل تسبب تقطيعًا.",
      fix: "أغلق التطبيقات الخلفية وزد حجم ملف ترقيم الصفحات (Pagefile).",
    },
    gpu_wake: {
      title: "عودة كرت الشاشة من وضع توفير الطاقة",
      simple: "ينتقل كرت الشاشة إلى وضع توفير الطاقة بين المشاهد ويحتاج وقتًا للعودة إلى وضع الأداء — وهذا الانتقال يظهر كتقطيع مرئي.",
      fix: "من لوحة تحكم كرت الشاشة، اجعل إدارة الطاقة \"تفضيل الأداء الأقصى\" لـ GameLoop — أضف كل عمليات GameLoop وليس اللعبة فقط. إن استمر الظهور، فالدرايفر يقصّر تردد الذاكرة في المشاهد الخفيفة — وهو أمر شائع على اللابتوبات hybrid graphics، وأثره عادة تقطيعة عابرة بين المشاهد وليس مشكلة دائمة.",
    },
    scene_hitch: {
      title: "تحميل مشهد لأول مرة",
      simple:
        "عند ظهور مشهد لأول مرة (الصالة الرئيسية أو خريطة جديدة) يجهّز النظام رسومياته — ما ينتج عنه تقطيع واحد مؤقت ثم سلاسة تامة، وتكون العودة إلى المشهد نفسه سلسة لاحقًا لأنه صار مخزنًا مؤقتًا.",
      fix: "لا يوجد حل جذري — تقل حدّته مع تكرار المشاهد وتتضاءل مع تحديث تعريف كرت الشاشة.",
    },
    gpu_busy: {
      title: "كرت الشاشة عند حدّه الأقصى",
      simple: "عمل كرت الشاشة عند أقصى طاقته — وانخفض معدل الإطارات نتيجة لذلك.",
      fix: "خفّض دقة اللعبة أو جودة الرسومات بمقدار درجة واحدة.",
    },
  } as Record<string, { title: string; simple: string; fix: string }>,

  // ---- reports ----
  sessions: "الجلسات",
  sessionsHint: "كل فحص مكتمل محفوظ على جهازك مع تقريره الكامل. اضغط على أي جلسة لقراءتها هنا.",
  noSessions: "لا جلسات بعد",
  noSessionsHint: "شغّل فحصًا من صفحة المراقبة — الجلسات المكتملة تظهر هنا مع تقاريرها.",
  loadingSessions: "جارٍ تحميل الجلسات...",
  allSessions: "كل الجلسات",
  sessionReport: "تقرير الجلسة",
  whatWeFound: "ما وجدناه",
  keyMoments: "اللحظات المفصلية",
  theNumbers: "الأرقام",
  noIssuesCaptured: "لم تُرصد مشاكل",
  noIssuesCapturedHint: "لم يكن في هذه الجلسة نتائج تستحق الذكر. إن أحسست بتقطيع رغم ذلك، شغّل فحصًا أطول وقت حدوثه.",
  openReportFile: "افتح ملف التقرير",
  openSessionsFolder: "افتح مجلد الجلسات",
  deleteSession: "حذف الجلسة",
  clean: "سليمة",
  findings: "نتائج",
  lagCaptured: "تقطيع مرصود",
  partial: "غير مكتملة",
  samples: "عينة",
  spikeCount: (n: number) => `${n} تقطيعة`,
};

export type LocaleAr = typeof ar;
