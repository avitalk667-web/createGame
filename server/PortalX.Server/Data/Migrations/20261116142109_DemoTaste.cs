using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class DemoTaste : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "DemoSessionId",
                table: "Orders",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "DemoSessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    InspectedMask = table.Column<int>(type: "integer", nullable: false),
                    HintsUsed = table.Column<int>(type: "integer", nullable: false),
                    CodeAttempts = table.Column<int>(type: "integer", nullable: false),
                    WrongStreak = table.Column<int>(type: "integer", nullable: false),
                    CooldownUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Device = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Variant = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    ReferralLinkId = table.Column<Guid>(type: "uuid", nullable: true),
                    LastEvent = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    OfferViewedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ProductClickedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ProductClickedId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CheckoutStartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PurchasedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DemoSessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DemoSessions_ReferralLinks_ReferralLinkId",
                        column: x => x.ReferralLinkId,
                        principalTable: "ReferralLinks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "DemoEvents",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: true),
                    Type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    At = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ProductId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Value = table.Column<int>(type: "integer", nullable: true),
                    Device = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    Variant = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    ReferralLinkId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DemoEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DemoEvents_DemoSessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "DemoSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Orders_DemoSessionId",
                table: "Orders",
                column: "DemoSessionId");

            migrationBuilder.CreateIndex(
                name: "IX_DemoEvents_SessionId",
                table: "DemoEvents",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_DemoEvents_Type_At",
                table: "DemoEvents",
                columns: new[] { "Type", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_DemoSessions_CreatedAt",
                table: "DemoSessions",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_DemoSessions_ReferralLinkId",
                table: "DemoSessions",
                column: "ReferralLinkId");

            migrationBuilder.CreateIndex(
                name: "IX_DemoSessions_TokenHash",
                table: "DemoSessions",
                column: "TokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DemoEvents");

            migrationBuilder.DropTable(
                name: "DemoSessions");

            migrationBuilder.DropIndex(
                name: "IX_Orders_DemoSessionId",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "DemoSessionId",
                table: "Orders");
        }
    }
}
