/**
 * Every word the mod shows, in Hebrew, in one place.
 */

export const NAME = 'המתנה'

export const INVITE = 'המתנה · התחברו כדי להרוויח בזמן ש-Claude עובד'

export const INVITE_BUTTON = 'התחברות'

/** The legal ad marking, and the default label. */
export const AD_LABEL = 'מודעה'

/** The label of a job ad. It still carries the ad marking. */
export const AD_LABEL_JOBS = 'דרושים · מודעה'

export const AD_LINK = 'לפרטים'

export const COMMAND_DESCRIPTION =
  'המתנה: חיבור חשבון, יתרה והשהיית מודעות'

export const COMMAND_HINT = '[status|pause|resume|login|logout]'

export const PANE_TITLE = 'המתנה'

export const PANE_INTRO =
  'מודעה קצרה בעברית מעל שורת הקלט, רק בזמן ש-Claude עובד. על כל צפייה אתם מרוויחים.'

export const WELCOME_TITLE = 'ברוכים הבאים להמתנה'

export const WELCOME_STEPS = [
  '1. לוחצים על "התחברות".',
  '2. הדפדפן נפתח עם הקוד. מתחברים ומאשרים.',
  '3. חוזרים לכאן. המודעות יופיעו רק בזמן ש-Claude עובד.',
]

export const PRIVACY =
  'התוסף לא קורא קבצים, פרומפטים או קוד. הוא שולח רק בקשה למודעה ואישור צפייה.'

export const UNLINKED = 'עוד לא חיברתם חשבון. בלי חיבור לא מוצגות מודעות.'

export const LINK_BUTTON = 'התחברות'

export const FLOW_STARTING = 'מתחברים לשרת…'

export const FLOW_CODE = 'קוד החיבור שלכם:'

export const FLOW_OPEN = 'הקוד כבר ממולא בקישור. פותחים ומאשרים:'

export const FLOW_OPEN_LINK = 'פתיחת הדפדפן לאישור'

export const FLOW_WAITING = 'ממתינים לאישור…'

export const FLOW_CANCEL = 'ביטול'

export const FLOW_EXPIRED = 'הקוד פג. אפשר לנסות שוב.'

export const FLOW_FAILED = 'לא הצלחנו להגיע לשרת. נסו שוב בעוד רגע.'

export const RETRY = 'ניסיון נוסף'

export const BAD_SERVER = 'כתובת השרת בהגדרות לא תקינה (צריך https).'

export const LOADING = 'טוען…'

export const ME_FAILED = 'לא הצלחנו לטעון נתונים.'

export const linkedAs = (name: string, email: string) =>
  name && email
    ? `מחוברים: ${name} (${email})`
    : `מחוברים: ${name || email || 'חשבון'}`

export const today = (money: string) => `היום: ${money}`

export const balances = (pending: string, available: string) =>
  `ממתין: ${pending} · זמין: ${available}`

export const impressions = (seen: string, cap: string) =>
  `חשיפות היום: ${seen} מתוך ${cap}`

export const ADS_ON = 'מודעות: פעילות'

export const ADS_OFF = 'מודעות: מושהות'

export const PAUSE = 'השהיית מודעות'

export const RESUME = 'חידוש מודעות'

export const DASHBOARD = 'לוח הבקרה'

export const UNLINK = 'ניתוק'

export const REFRESH = 'רענון'

export const TOAST_LINKED =
  'החשבון חובר. מעכשיו תופיע מודעה בזמן ש-Claude עובד.'

export const TOAST_UNLINKED = 'החשבון נותק.'

export const TOAST_SIGNED_OUT = 'החיבור להמתנה פג. לחיבור מחדש: /hamtana'

export const TEXT_UNLINKED =
  'לא מחוברים. אין מודעות עד שמחברים חשבון.\nלחיבור: /hamtana (או /hamtana login)'

export const TEXT_PAUSED = 'המודעות הושהו. להמשך: /hamtana resume'

export const TEXT_RESUMED = 'המודעות חזרו. הן יופיעו רק בזמן ש-Claude עובד.'

export const TEXT_LOGGED_OUT = 'החשבון נותק. לחיבור מחדש: /hamtana'

export const TEXT_NOT_LINKED_LOGOUT = 'אין חשבון מחובר.'

export const TEXT_ALREADY_LINKED = 'כבר מחוברים. לפרטים: /hamtana status'

export const textLogin = (userCode: string, url: string) =>
  `כדי לחבר: פתחו ${url} ואשרו את הקוד ${userCode}\nהקוד בתוקף 10 דקות. אחרי האישור: /hamtana status`

export const TEXT_REFRESH_FAILED = '(לא הצלחנו לרענן מהשרת)'

export const TEXT_HELP = [
  'פקודות:',
  '/hamtana: פותח את החלונית (או מצב בטקסט)',
  '/hamtana status: חיבור, רווחים וחשיפות',
  '/hamtana pause | resume: השהיה והמשך של מודעות',
  '/hamtana login: חיבור חשבון עם קוד',
  '/hamtana logout: ניתוק החשבון',
].join('\n')
