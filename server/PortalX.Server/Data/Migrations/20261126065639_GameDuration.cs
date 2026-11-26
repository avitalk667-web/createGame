using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class GameDuration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "DurationIsMinimum",
                table: "Products",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "DurationMinutes",
                table: "Products",
                type: "integer",
                nullable: true);

            // the play times of the existing games (the same values as products.he.json for a new database); no other field is touched
            migrationBuilder.Sql("UPDATE \"Products\" SET \"DurationMinutes\" = 60, \"DurationIsMinimum\" = false WHERE \"Id\" = 'last-portal' AND \"DurationMinutes\" IS NULL;");
            migrationBuilder.Sql("UPDATE \"Products\" SET \"DurationMinutes\" = 60, \"DurationIsMinimum\" = true WHERE \"Id\" = 'hanukkah-oil' AND \"DurationMinutes\" IS NULL;");
            migrationBuilder.Sql("UPDATE \"Products\" SET \"DurationMinutes\" = 45, \"DurationIsMinimum\" = true WHERE \"Id\" = 'stone-maze' AND \"DurationMinutes\" IS NULL;");
            migrationBuilder.Sql("UPDATE \"Products\" SET \"DurationMinutes\" = 60, \"DurationIsMinimum\" = true WHERE \"Id\" = 'couples-cipher' AND \"DurationMinutes\" IS NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DurationIsMinimum",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "DurationMinutes",
                table: "Products");
        }
    }
}
