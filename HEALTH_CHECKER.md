# Health Checker - מערכת בדיקת סטטוס אוטומטית

## מה זה עושה?
מערכת שבודקת **אוטומטית** את סטטוס כל המכשירים כל **5 דקות**.

## איך זה עובד?
- כאשר Backend עולה, הוא מפעיל תהליך רקע (background task)
- כל 5 דקות המערכת:
  - בודקת חיבור לכל מכשיר
  - מעדכנת סטטוס (online/offline)
  - מעדכנת CPU, Memory, Sessions
  - מעדכנת Last Seen

## איך לבדוק שזה עובד?
1. הפעל את הפרויקט עם `start.bat`
2. פתח את הממשק ב- http://localhost:3001
3. עבור לדף Devices
4. נתק מכשיר (או שנה כתובת IP למכשיר לא קיים)
5. **חכה 5 דקות**
6. לחץ Refresh או רענן את הדף
7. הסטטוס יתעדכן ל-OFFLINE

## רפרש ידני
בנוסף לבדיקה האוטומטית, יש כפתור **Refresh** בממשק:
- **Grid View**: כפתור Refresh בתוך כל DeviceCard
- **List View**: כפתור Refresh בטבלה
- **Device Detail Panel**: כפתור Refresh בתוך הפאנל

## קבצים רלוונטיים
- `backend/app/services/health_checker.py` - לוגיקת הבדיקה
- `backend/app/main.py` - הפעלת ה-background task
- `frontend/src/pages/Devices.tsx` - ממשק המשתמש
- `frontend/src/components/DeviceCard.tsx` - כרטיס מכשיר

## לוג
הבדיקות מתועדות ב-backend log:
```
[HEALTH CHECKER] Started - running every 5 minutes
[OK] Device FW-HQ-01 is ONLINE
[FAIL] Device FW-BRANCH-01 is OFFLINE: Connection timeout
Health check complete: 5 online, 1 offline
```

## הגדרות
כרגע מוגדר ל-**5 דקות** (300 שניות).
לשינוי, ערוך את `health_checker.py` שורה 65:
```python
await asyncio.sleep(300)  # שנה ל-180 למשל (3 דקות)
```
