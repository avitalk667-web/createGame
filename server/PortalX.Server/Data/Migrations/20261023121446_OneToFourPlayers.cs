using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class OneToFourPlayers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Every game is for 1-4 players (spec): the minimum drops to one; existing games, orders and players are untouched.
            migrationBuilder.Sql("UPDATE \"Products\" SET \"MinPlayers\" = 1 WHERE \"MinPlayers\" > 1;");
            migrationBuilder.Sql("UPDATE \"Products\" SET \"FeaturesJson\" = replace(\"FeaturesJson\"::text, 'עד 4 משתתפים', '1–4 משתתפים')::jsonb;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // nothing to undo: a minimum of one player is valid for every game
        }
    }
}
