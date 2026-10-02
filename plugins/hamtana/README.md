# המתנה (Hamtana)

מוד ל-Claude Code. בזמן ש-Claude עובד, מופיעה מעל הפרומפט מודעה קצרה אחת בעברית, עם התווית "מודעה". על כל צפייה אתם מרוויחים כסף. בלי חיבור חשבון לא מוצגת שום מודעה.

צריך Claude Code בגרסה 2.1.287 ומעלה. נבדק על 2.1.287.

## התקנה

בתוך Claude Code:

```
/plugin marketplace add OronNessim/hamtana-plugin-plugin
/plugin install hamtana@hamtana
```

## חיבור חשבון

מקלידים `/hamtana` ולוחצים "התחבר". מופיע קוד וקישור. פותחים את הקישור, מתחברים לאתר ומאשרים את הקוד. זהו.

בלי חלונית (למשל ב-VS Code או ב-`claude -p`):

```
/hamtana login     חיבור עם קוד
/hamtana status    חיבור, רווחים וחשיפות
/hamtana pause     השהיית מודעות
/hamtana resume    המשך מודעות
/hamtana logout    ניתוק החשבון
```

המודעות מוצגות רק בטרמינל ובאפליקציית Desktop, ורק בזמן ש-Claude עובד. צפייה נספרת רק אחרי שהמודעה הייתה על המסך ברצף כמה שניות.

## פרטיות

המוד לא קורא קבצים, לא מריץ פקודות, לא קורא משתני סביבה ולא רואה פרומפטים, קוד או תשובות. הוא יודע רק מתי תור של Claude מתחיל ונגמר.

הוא פונה רק לשרת של המתנה, ושולח: בקשה למודעה, אישור צפייה, ופרטי החשבון שלכם לחלונית. הטוקן של המכשיר נשמר מקומית ב-store של Claude Code.

אפשר לבדוק בעצמכם מה המוד עושה:

```
claude plugin validate <תיקיית המוד>
```

שורות `hooks:` ו-`calls:` מראות כל אירוע וכל קריאה.

## עברית בטרמינל

ההגדרה `terminalHebrew` ב-`/config`:

- `auto` (ברירת מחדל): לא משנה את הטקסט. ב-Windows, Claude Code כבר מסדר עברית בעצמו.
- `reverse`: הופך את סדר האותיות, לטרמינל שמציג עברית הפוך.
- `plain`: אף פעם לא הופך.

ב-Desktop הטקסט לא משתנה אף פעם.

## כיבוי

- להשהות מודעות: `/hamtana pause`
- לנתק את החשבון: `/hamtana logout`
- לכבות את המוד: `/plugin`, לשונית Installed, ואז disable או uninstall ל-hamtana

## פיתוח

```
claude --plugin-dir ./mod
claude plugin validate ./mod
cd mod && claude plugin test
```
