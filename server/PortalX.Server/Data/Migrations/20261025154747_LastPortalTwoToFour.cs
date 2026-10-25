using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class LastPortalTwoToFour : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // "The Last Portal" is played by 2-4 players (the other games keep 1-4); games, orders and players are untouched
            migrationBuilder.Sql("UPDATE \"Products\" SET \"MinPlayers\" = 2 WHERE \"Id\" = 'last-portal' AND \"MinPlayers\" < 2;");
            migrationBuilder.Sql("UPDATE \"Products\" SET \"FeaturesJson\" = replace(\"FeaturesJson\"::text, '1–4 משתתפים', '2–4 משתתפים')::jsonb WHERE \"Id\" = 'last-portal';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("UPDATE \"Products\" SET \"MinPlayers\" = 1 WHERE \"Id\" = 'last-portal';");
        }
    }
}
