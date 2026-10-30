using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class SaleOpeningAndFaqImport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "SaleOpensAt",
                table: "Products",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "SalePaused",
                table: "Products",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "ShowBeforeSale",
                table: "Products",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            // the questions the site shipped with become ordinary FAQ rows, once, ahead of the admin's own (negative order);
            // from now on the admin edits or deletes them like any other question, and the home page reads only this table
            migrationBuilder.Sql("INSERT INTO \"Faq\" (\"Id\", \"Question\", \"Answer\", \"SortOrder\", \"Published\", \"CreatedBy\", \"CreatedAt\", \"UpdatedAt\") VALUES ('92e68f67-3776-4409-a441-238637bd9256', 'מהו PORTAL X?', 'PORTAL X היא מערכת של חדרי בריחה דיגיטליים תלת־ממדיים. המשתתפים חוקרים חדרים, אוספים רמזים, מפעילים מנגנונים ופותרים חידות יחד.', -10, TRUE, 'site', now(), now()) ON CONFLICT (\"Id\") DO NOTHING;");
            migrationBuilder.Sql("INSERT INTO \"Faq\" (\"Id\", \"Question\", \"Answer\", \"SortOrder\", \"Published\", \"CreatedBy\", \"CreatedAt\", \"UpdatedAt\") VALUES ('06c522db-e03d-4122-aff3-abd113cee964', 'כמה משתתפים יכולים לשחק יחד?', 'בכל משחק יכולים להשתתף עד ארבעה שחקנים, כולל המארח. ב„הפורטל האחרון” צריך לפחות שני משתתפים; ב„סוד פך השמן” וב„שער הסודות” אפשר לשחק גם לבד.', -9, TRUE, 'site', now(), now()) ON CONFLICT (\"Id\") DO NOTHING;");
            migrationBuilder.Sql("INSERT INTO \"Faq\" (\"Id\", \"Question\", \"Answer\", \"SortOrder\", \"Published\", \"CreatedBy\", \"CreatedAt\", \"UpdatedAt\") VALUES ('a409a2a9-e331-43df-a90b-66271a8d8146', 'האם צריך להתקין תוכנה?', 'המשחק פועל דרך הדפדפן. יש לפתוח את הקישור המתאים ולהצטרף למשחק באמצעות קוד המשחק.', -8, TRUE, 'site', now(), now()) ON CONFLICT (\"Id\") DO NOTHING;");
            migrationBuilder.Sql("INSERT INTO \"Faq\" (\"Id\", \"Question\", \"Answer\", \"SortOrder\", \"Published\", \"CreatedBy\", \"CreatedAt\", \"UpdatedAt\") VALUES ('a7a0a1b1-097e-4dc2-a52d-4ca99124ad6b', 'האם אפשר לשחק מרחוק?', 'כן. אפשר להזמין משתתפים נוספים באמצעות קוד המשחק, והם יכולים להצטרף מהמחשבים שלהם.', -7, TRUE, 'site', now(), now()) ON CONFLICT (\"Id\") DO NOTHING;");
            migrationBuilder.Sql("INSERT INTO \"Faq\" (\"Id\", \"Question\", \"Answer\", \"SortOrder\", \"Published\", \"CreatedBy\", \"CreatedAt\", \"UpdatedAt\") VALUES ('210de8bf-9d69-4059-a36d-f96175b615ce', 'איך רוכשים משחק?', 'בוחרים את המשחק הרצוי בדף הבית, עוברים לתהליך הרכישה ופועלים לפי ההוראות. הגישה למשחק בתשלום נפתחת לאחר אישור התשלום.', -6, TRUE, 'site', now(), now()) ON CONFLICT (\"Id\") DO NOTHING;");
            migrationBuilder.Sql("INSERT INTO \"Faq\" (\"Id\", \"Question\", \"Answer\", \"SortOrder\", \"Published\", \"CreatedBy\", \"CreatedAt\", \"UpdatedAt\") VALUES ('6b576842-06c1-462e-a884-55e8769d08dc', 'האם יש משחק שאפשר לנסות בחינם?', 'כן. יש משחק דוגמה חינמי הכולל שני חדרי בריחה. אפשר לשחק בו ולהכיר את חוויית PORTAL X לפני רכישת משחק מלא.', -5, TRUE, 'site', now(), now()) ON CONFLICT (\"Id\") DO NOTHING;");
            migrationBuilder.Sql("INSERT INTO \"Faq\" (\"Id\", \"Question\", \"Answer\", \"SortOrder\", \"Published\", \"CreatedBy\", \"CreatedAt\", \"UpdatedAt\") VALUES ('3abc80ac-3016-4bd3-a8fd-907fa308386c', 'האם צריך שכל המשתתפים ישלמו?', 'לא. הרכישה היא עבור משחק קבוצתי בהתאם למחיר ולתנאים המוצגים בעמוד המשחק. המשתתפים האחרים מצטרפים באמצעות קוד המשחק.', -4, TRUE, 'site', now(), now()) ON CONFLICT (\"Id\") DO NOTHING;");
            migrationBuilder.Sql("INSERT INTO \"Faq\" (\"Id\", \"Question\", \"Answer\", \"SortOrder\", \"Published\", \"CreatedBy\", \"CreatedAt\", \"UpdatedAt\") VALUES ('7afd8aed-0233-4795-af49-5edd6905c899', 'האם לכל שחקן יש ניקוד אישי?', 'כן. במהלך המשחק נצבר ניקוד אישי על פתרון חידות ופעולות משמעותיות, ובסיום מוצגת טבלת תוצאות.', -3, TRUE, 'site', now(), now()) ON CONFLICT (\"Id\") DO NOTHING;");
            migrationBuilder.Sql("INSERT INTO \"Faq\" (\"Id\", \"Question\", \"Answer\", \"SortOrder\", \"Published\", \"CreatedBy\", \"CreatedAt\", \"UpdatedAt\") VALUES ('ace5e5a0-e705-40c5-a8f1-c5b159865ee2', 'מה קורה אם מתנתקים באמצע המשחק?', 'ניתן לחזור למשחק בהתאם לכללי שמירת המקום וההתחברות מחדש. יש להשתמש באותו קוד משחק ובמנגנון החזרה של המשחק.', -2, TRUE, 'site', now(), now()) ON CONFLICT (\"Id\") DO NOTHING;");
            migrationBuilder.Sql("INSERT INTO \"Faq\" (\"Id\", \"Question\", \"Answer\", \"SortOrder\", \"Published\", \"CreatedBy\", \"CreatedAt\", \"UpdatedAt\") VALUES ('1071038e-cc11-43fd-a211-6da9eeadd137', 'מה עושים אם יש תקלה?', 'יש לפנות לתמיכה באמצעות פרטי הקשר שיוגדרו במערכת.', -1, TRUE, 'site', now(), now()) ON CONFLICT (\"Id\") DO NOTHING;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SaleOpensAt",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "SalePaused",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "ShowBeforeSale",
                table: "Products");

            migrationBuilder.Sql("DELETE FROM \"Faq\" WHERE \"CreatedBy\" = 'site';");
        }
    }
}
