# PORTAL X — שליחת מיילים דרך Gmail API (OAuth)

המיילים נשלחים מהשרת דרך **Gmail API ב־HTTPS** (פורט 443), מהחשבון **info.portalx@gmail.com**, בהרשאת שליחה בלבד (`gmail.send`). אין שימוש ב־SMTP — בתוכנית Render Free יציאות SMTP (25, 465, 587) חסומות.

## איך זה עובד

1. מנהלת לוחצת בממשק הניהול ← „הגדרת שליחת מיילים” ← **חיבור חשבון Gmail**.
2. השרת יוצר `state` חד־פעמי (תוקף 10 דקות), PKCE ועוגיית קישור לדפדפן, ומפנה לעמוד ההסכמה של Google.
3. מתחברים בחשבון info.portalx@gmail.com ומאשרים שליחת מיילים.
4. Google מחזירה ל־`/api/admin/email/google/callback`. השרת בודק את ה־state, את העוגייה ואת PKCE, מחליף את הקוד בטוקנים, מוודא שהחשבון הוא info.portalx@gmail.com ושהרשאת השליחה ניתנה, ושומר את ה־Refresh Token **מוצפן** (AES-256-GCM) במסד.
5. מכאן השרת מחדש לבד את ה־Access Token לפי הצורך. אם ההרשאה בוטלה או פגה — מוצג „דרוש חיבור מחדש”, ואפשרות שליחת התוצאות מוסתרת עד לחיבור מחדש.

ההרשאות המבוקשות: `https://www.googleapis.com/auth/gmail.send` (שליחה בלבד) ו־`openid email` (רק כדי לוודא שחובר החשבון הנכון). אין הרשאת קריאה, מחיקה או ניהול של תיבת הדואר.

## משתני סביבה ב־Render

| משתנה | ערך | סוד? |
|---|---|---|
| `GOOGLE_CLIENT_ID` | מתוך ה־OAuth Client שנוצר ב־Google Cloud | לא, אבל לא לפרסם |
| `GOOGLE_CLIENT_SECRET` | מתוך אותו OAuth Client | **כן** |
| `GOOGLE_REDIRECT_URI` | `https://portal-x-scfm.onrender.com/api/admin/email/google/callback` | לא |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | מחרוזת אקראית של 32 תווים לפחות (מומלץ 64). **לא לשנות אחרי החיבור** — שינוי מחייב חיבור מחדש | **כן** |
| `PORTALX_SITE_URL` | `https://portal-x-scfm.onrender.com` | לא |
| `PORTALX_COMMUNITY_GROUP_URL` | קישור ההזמנה לקבוצה (https בלבד) | לא |
| `PORTALX_UNSUBSCRIBE_SECRET` | מחרוזת אקראית של 32 תווים לפחות | **כן** |

את משתני ה־SMTP הקודמים (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_APP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `SMTP_REPLY_TO`) הקוד כבר לא קורא. מומלץ למחוק אותם מ־Render, ולבטל את סיסמת האפליקציה בחשבון Google (myaccount.google.com/apppasswords).

## Google Cloud Console — צעד אחר צעד

1. נכנסים ל־https://console.cloud.google.com/ בחשבון info.portalx@gmail.com.
2. למעלה: בחירת פרויקט ← **New Project** ← שם: `PORTAL X` ← Create. מוודאים שהפרויקט החדש נבחר.
3. **APIs & Services ← Library** ← מחפשים **Gmail API** ← **Enable**.
4. **Google Auth Platform** (בעבר „OAuth consent screen”) ← **Get started**:
   - App name: `PORTAL X`; User support email: info.portalx@gmail.com.
   - Audience: **External** (חשבון Gmail פרטי לא יכול לבחור Internal).
   - Contact information: info.portalx@gmail.com ← Create.
5. **Branding**: Application home page `https://portal-x-scfm.onrender.com`, Privacy policy `https://portal-x-scfm.onrender.com/info/privacy`, Terms `https://portal-x-scfm.onrender.com/info/terms`.
6. **Data Access ← Add or remove scopes**: מסמנים רק `.../auth/gmail.send` (וגם `openid` ו־`.../auth/userinfo.email`). שום הרשאה אחרת ← Update ← Save.
7. **Audience ← Test users ← Add users**: info.portalx@gmail.com (נדרש כל עוד האפליקציה במצב Testing).
8. **Clients ← Create client** ← Application type: **Web application** ← Name: `PORTAL X server`.
9. **Authorized redirect URIs ← Add URI** — בדיוק:
   `https://portal-x-scfm.onrender.com/api/admin/email/google/callback`
   (Authorized JavaScript origins — לא נדרש) ← Create.
10. בחלון שנפתח: מעתיקים את **Client ID** ואת **Client secret** ישירות לשדות `GOOGLE_CLIENT_ID` ו־`GOOGLE_CLIENT_SECRET` ב־Render (Environment ← Save). לא להדביק אותם בצ׳אט, במייל או בקוד.

אחרי שמירה ב־Render והפריסה מחדש: ממשק הניהול ← „הגדרת שליחת מיילים” ← **חיבור חשבון Gmail** ← אחרי החזרה ← **שליחת מייל בדיקה**.

## מצב פרסום, 7 ימים ואימות של Google

- **Testing** (ברירת המחדל): עובד רק עם משתמשי הבדיקה, ו־**ה־Refresh Token פג אחרי 7 ימים** (כי gmail.send אינה הרשאת פרופיל בסיסית). כל שבוע יופיע בממשק „דרוש חיבור מחדש”, ושליחת התוצאות תוסתר עד שתלחצי „חיבור Gmail מחדש”.
- **In production** (Audience ← Publish app): ה־Refresh Token לא פג אחרי 7 ימים. הוא עדיין יכול להתבטל — אם ההרשאה מבוטלת בחשבון Google, אם הסיסמה של החשבון משתנה, אם לא נעשה בו שימוש כחצי שנה, או אם נוצרים יותר מ־100 טוקנים לאותו לקוח. אחרי מעבר ל־Production צריך לחבר מחדש פעם אחת, כדי לקבל טוקן חדש.
- **gmail.send היא הרשאה רגישה (sensitive)**. אפליקציה שלא עברה אימות של Google מציגה בעמוד ההסכמה מסך „Google hasn't verified this app”, ומוגבלת ל־100 משתמשים. לפי Google, אפליקציה לשימוש אישי (פחות מ־100 משתמשים) יכולה לפעול בלי אימות. כאן רק חשבון אחד מאשר — info.portalx@gmail.com — והנמענים לא מאשרים דבר.
- **אימות מלא** (מסיר את המסך ואת המגבלה) דורש בין השאר דומיין בבעלותך המאומת ב־Google Search Console, דפי בית ופרטיות בדומיין הזה, הסבר וסרטון הדגמה של השימוש בהרשאה, וזמן בדיקה של כ־10 ימי עסקים. כתובת `onrender.com` אינה דומיין בבעלותך.
- ההחלטה בין Testing (חיבור מחדש שבועי) לבין Production בלי אימות (מסך אזהרה של Google בעת החיבור) או אימות מלא היא שלך. אין לעקוף אזהרות אבטחה או להסיר הגנות מהחשבון.

## מה נשמר ואיך

- **MailAccounts** — שורה אחת: החשבון, מצב החיבור, ה־Refresh Token מוצפן (AES-256-GCM, קשור לכתובת החשבון), טביעת אצבע של מפתח ההצפנה (לא המפתח), שגיאה אחרונה (קוד קצר בלבד), מועדי שליחה ובדיקה. Access Token נשמר רק בזיכרון.
- **OAuthStates** — ניסיונות חיבור: hash של ה־state ושל עוגיית הקישור, PKCE, תוקף 10 דקות, שימוש חד־פעמי.
- **ResultEmailRequests** — לכל בקשה: הסטטוס (ממתין / נשלח / נכשל / לא ודאי), מספר הניסיונות, ו־**מזהה ההודעה ש־Gmail החזיר**. „נשלח” רק אחרי אישור של Gmail.
- הסכמות שיווקיות, בקשות קישור לקבוצה וקישורי הסרה — כמו קודם, בנפרד מבקשות התוצאות.

## לפני הפעלה מסחרית

יש לבדוק עם עורך דין את נוסחי ההסכמה, את מדיניות הפרטיות ואת תקופת השמירה מול הדין החל.
