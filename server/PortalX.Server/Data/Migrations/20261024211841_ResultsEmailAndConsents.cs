using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class ResultsEmailAndConsents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AppSecrets",
                columns: table => new
                {
                    Name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Value = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AppSecrets", x => x.Name);
                });

            migrationBuilder.CreateTable(
                name: "CommunityLinkRequests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    Round = table.Column<int>(type: "integer", nullable: false),
                    PlayerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Source = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    RequestedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CommunityLinkRequests", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MarketingConsents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    ConsentedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Source = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    SourceRoomId = table.Column<Guid>(type: "uuid", nullable: true),
                    ConsentVersion = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ConsentText = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    TokenStamp = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MarketingConsents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ResultEmailRequests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    Round = table.Column<int>(type: "integer", nullable: false),
                    PlayerId = table.Column<Guid>(type: "uuid", nullable: false),
                    GameResultId = table.Column<Guid>(type: "uuid", nullable: true),
                    ScenarioId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ProductId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    ResultsRequested = table.Column<bool>(type: "boolean", nullable: false),
                    GameEndedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RequestedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    LastAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ResultEmailRequests", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CommunityLinkRequests_RequestedAt",
                table: "CommunityLinkRequests",
                column: "RequestedAt");

            migrationBuilder.CreateIndex(
                name: "IX_CommunityLinkRequests_RoomId_Round_PlayerId",
                table: "CommunityLinkRequests",
                columns: new[] { "RoomId", "Round", "PlayerId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MarketingConsents_Email",
                table: "MarketingConsents",
                column: "Email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MarketingConsents_Status",
                table: "MarketingConsents",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_ResultEmailRequests_Email",
                table: "ResultEmailRequests",
                column: "Email");

            migrationBuilder.CreateIndex(
                name: "IX_ResultEmailRequests_IdempotencyKey",
                table: "ResultEmailRequests",
                column: "IdempotencyKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ResultEmailRequests_RequestedAt",
                table: "ResultEmailRequests",
                column: "RequestedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AppSecrets");

            migrationBuilder.DropTable(
                name: "CommunityLinkRequests");

            migrationBuilder.DropTable(
                name: "MarketingConsents");

            migrationBuilder.DropTable(
                name: "ResultEmailRequests");
        }
    }
}
