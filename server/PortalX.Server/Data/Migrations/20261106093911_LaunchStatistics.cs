using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class LaunchStatistics : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "FirstStartedAt",
                table: "Rooms",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ReferralLinkId",
                table: "Rooms",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ReferralClicks",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ReferralLinkId = table.Column<Guid>(type: "uuid", nullable: false),
                    At = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReferralClicks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReferralClicks_ReferralLinks_ReferralLinkId",
                        column: x => x.ReferralLinkId,
                        principalTable: "ReferralLinks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Rooms_FirstStartedAt",
                table: "Rooms",
                column: "FirstStartedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Rooms_ReferralLinkId",
                table: "Rooms",
                column: "ReferralLinkId");

            migrationBuilder.CreateIndex(
                name: "IX_ReferralClicks_At",
                table: "ReferralClicks",
                column: "At");

            migrationBuilder.CreateIndex(
                name: "IX_ReferralClicks_ReferralLinkId_At",
                table: "ReferralClicks",
                columns: new[] { "ReferralLinkId", "At" });

            // games that started before this column existed: their first start is the earliest moment on record
            // (the opening scene, the play, or the first result of a game that was replayed since); nothing else is changed
            migrationBuilder.Sql("""
                UPDATE "Rooms" r SET "FirstStartedAt" = COALESCE(r."IntroStartedAt", r."StartedAt",
                    (SELECT MIN(x."CreatedAt") FROM "Results" x WHERE x."RoomId" = r."Id"))
                WHERE r."FirstStartedAt" IS NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReferralClicks");

            migrationBuilder.DropIndex(
                name: "IX_Rooms_FirstStartedAt",
                table: "Rooms");

            migrationBuilder.DropIndex(
                name: "IX_Rooms_ReferralLinkId",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "FirstStartedAt",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "ReferralLinkId",
                table: "Rooms");
        }
    }
}
