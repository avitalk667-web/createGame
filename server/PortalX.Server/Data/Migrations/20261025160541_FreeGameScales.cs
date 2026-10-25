using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class FreeGameScales : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // the free game's second room has the ancient scales instead of the mirrors: only the product text changes
            migrationBuilder.Sql("UPDATE \"Products\" SET \"Description\" = replace(\"Description\", 'מרכיבים גלגלי שיניים ומכוונים מראות כדי לנתב אור אל השער.', 'מרכיבים גלגלי שיניים ומאזנים מאזניים עתיקים כדי לפתוח את השער.') WHERE \"Id\" = 'gate-of-secrets';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("UPDATE \"Products\" SET \"Description\" = replace(\"Description\", 'מרכיבים גלגלי שיניים ומאזנים מאזניים עתיקים כדי לפתוח את השער.', 'מרכיבים גלגלי שיניים ומכוונים מראות כדי לנתב אור אל השער.') WHERE \"Id\" = 'gate-of-secrets';");
        }
    }
}
