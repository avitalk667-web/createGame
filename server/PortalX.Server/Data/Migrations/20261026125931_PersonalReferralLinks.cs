using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class PersonalReferralLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ReferralAttributedAt",
                table: "Orders",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReferralExclusion",
                table: "Orders",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ReferralLinkId",
                table: "Orders",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "MarketingConsentEvents",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Source = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ConsentVersion = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    At = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MarketingConsentEvents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ReferralLinks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Token = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    FirstName = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    LastName = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DisabledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Source = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    MarketingConsent = table.Column<bool>(type: "boolean", nullable: false),
                    ConsentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ConsentVersion = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ConsentText = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    TermsAcceptedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastEmailAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastEmailStatus = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    LastEmailError = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    LastEmailMessageId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    EmailsSent = table.Column<int>(type: "integer", nullable: false),
                    CommissionMode = table.Column<int>(type: "integer", nullable: false),
                    CommissionRate = table.Column<decimal>(type: "numeric(6,4)", precision: 6, scale: 4, nullable: true),
                    FixedCommissionAmount = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: true),
                    CommissionEnabled = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReferralLinks", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ReferralVisits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ReferralLinkId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastClickAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReferralVisits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReferralVisits_ReferralLinks_ReferralLinkId",
                        column: x => x.ReferralLinkId,
                        principalTable: "ReferralLinks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Orders_ReferralLinkId",
                table: "Orders",
                column: "ReferralLinkId");

            migrationBuilder.CreateIndex(
                name: "IX_MarketingConsentEvents_Email",
                table: "MarketingConsentEvents",
                column: "Email");

            migrationBuilder.CreateIndex(
                name: "IX_ReferralLinks_CreatedAt",
                table: "ReferralLinks",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_ReferralLinks_Email",
                table: "ReferralLinks",
                column: "Email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReferralLinks_Token",
                table: "ReferralLinks",
                column: "Token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReferralVisits_LastClickAt",
                table: "ReferralVisits",
                column: "LastClickAt");

            migrationBuilder.CreateIndex(
                name: "IX_ReferralVisits_ReferralLinkId",
                table: "ReferralVisits",
                column: "ReferralLinkId");

            migrationBuilder.CreateIndex(
                name: "IX_ReferralVisits_TokenHash",
                table: "ReferralVisits",
                column: "TokenHash",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Orders_ReferralLinks_ReferralLinkId",
                table: "Orders",
                column: "ReferralLinkId",
                principalTable: "ReferralLinks",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // the consent history starts with what is already recorded (no existing row is changed)
            migrationBuilder.Sql("INSERT INTO \"MarketingConsentEvents\" (\"Email\", \"Action\", \"Source\", \"ConsentVersion\", \"At\") SELECT \"Email\", 'granted', \"Source\", \"ConsentVersion\", \"ConsentedAt\" FROM \"MarketingConsents\";");
            migrationBuilder.Sql("INSERT INTO \"MarketingConsentEvents\" (\"Email\", \"Action\", \"Source\", \"ConsentVersion\", \"At\") SELECT \"Email\", 'revoked', 'unsubscribe-link', NULL, \"RevokedAt\" FROM \"MarketingConsents\" WHERE \"RevokedAt\" IS NOT NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Orders_ReferralLinks_ReferralLinkId",
                table: "Orders");

            migrationBuilder.DropTable(
                name: "MarketingConsentEvents");

            migrationBuilder.DropTable(
                name: "ReferralVisits");

            migrationBuilder.DropTable(
                name: "ReferralLinks");

            migrationBuilder.DropIndex(
                name: "IX_Orders_ReferralLinkId",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "ReferralAttributedAt",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "ReferralExclusion",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "ReferralLinkId",
                table: "Orders");
        }
    }
}
