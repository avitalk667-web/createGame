using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class ChallengeCoupons : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BrowserKey",
                table: "Coupons",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CampaignId",
                table: "Coupons",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CancelledAt",
                table: "Coupons",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CancelledBy",
                table: "Coupons",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Email",
                table: "Coupons",
                type: "character varying(254)",
                maxLength: 254,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "EmailAttempts",
                table: "Coupons",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "EmailLastAttemptAt",
                table: "Coupons",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EmailLastError",
                table: "Coupons",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EmailMessageId",
                table: "Coupons",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "EmailSentAt",
                table: "Coupons",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EmailStatus",
                table: "Coupons",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FinalScore",
                table: "Coupons",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PlayerId",
                table: "Coupons",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "RoomId",
                table: "Coupons",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CouponCampaigns",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    IssuingPaused = table.Column<bool>(type: "boolean", nullable: false),
                    MinimumScore = table.Column<int>(type: "integer", nullable: false),
                    DiscountPercentage = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    ValidityDays = table.Column<int>(type: "integer", nullable: false),
                    MaxCoupons = table.Column<int>(type: "integer", nullable: false),
                    IssuedCouponsCount = table.Column<int>(type: "integer", nullable: false),
                    SourceProductId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ShowEntryPopup = table.Column<bool>(type: "boolean", nullable: false),
                    ShowProgress = table.Column<bool>(type: "boolean", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CouponCampaigns", x => x.Id);
                    table.CheckConstraint("CK_CouponCampaigns_Discount", "\"DiscountPercentage\" > 0 AND \"DiscountPercentage\" < 100");
                    table.CheckConstraint("CK_CouponCampaigns_Quota", "\"MaxCoupons\" >= 0 AND \"IssuedCouponsCount\" >= 0");
                    table.CheckConstraint("CK_CouponCampaigns_Validity", "\"ValidityDays\" BETWEEN 1 AND 365");
                    table.ForeignKey(
                        name: "FK_CouponCampaigns_Products_SourceProductId",
                        column: x => x.SourceProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CouponEvents",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CouponId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Actor = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    DetailsJson = table.Column<string>(type: "jsonb", nullable: false),
                    At = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CouponEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CouponEvents_Coupons_CouponId",
                        column: x => x.CouponId,
                        principalTable: "Coupons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CouponCampaignProducts",
                columns: table => new
                {
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CouponCampaignProducts", x => new { x.CampaignId, x.ProductId });
                    table.ForeignKey(
                        name: "FK_CouponCampaignProducts_CouponCampaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "CouponCampaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CouponCampaignProducts_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PlayerCouponEligibility",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uuid", nullable: false),
                    PlayerId = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    Round = table.Column<int>(type: "integer", nullable: false),
                    BrowserKey = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    FinalScore = table.Column<int>(type: "integer", nullable: false),
                    IsEligible = table.Column<bool>(type: "boolean", nullable: false),
                    Reason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    Email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    CouponId = table.Column<Guid>(type: "uuid", nullable: true),
                    MarketingConsent = table.Column<bool>(type: "boolean", nullable: false),
                    ConsentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ConsentVersion = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    ConsentSource = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlayerCouponEligibility", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PlayerCouponEligibility_CouponCampaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "CouponCampaigns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PlayerCouponEligibility_Coupons_CouponId",
                        column: x => x.CouponId,
                        principalTable: "Coupons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_PlayerCouponEligibility_Rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "Rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Coupons_CampaignId_BrowserKey",
                table: "Coupons",
                columns: new[] { "CampaignId", "BrowserKey" },
                unique: true,
                filter: "\"CampaignId\" IS NOT NULL AND \"BrowserKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Coupons_CampaignId_Email",
                table: "Coupons",
                columns: new[] { "CampaignId", "Email" },
                unique: true,
                filter: "\"CampaignId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Coupons_CampaignId_PlayerId",
                table: "Coupons",
                columns: new[] { "CampaignId", "PlayerId" },
                unique: true,
                filter: "\"CampaignId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CouponCampaignProducts_ProductId",
                table: "CouponCampaignProducts",
                column: "ProductId");

            migrationBuilder.CreateIndex(
                name: "IX_CouponCampaigns_SourceProductId",
                table: "CouponCampaigns",
                column: "SourceProductId");

            migrationBuilder.CreateIndex(
                name: "IX_CouponEvents_CouponId_At",
                table: "CouponEvents",
                columns: new[] { "CouponId", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerCouponEligibility_CampaignId_IsEligible",
                table: "PlayerCouponEligibility",
                columns: new[] { "CampaignId", "IsEligible" });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerCouponEligibility_CampaignId_PlayerId",
                table: "PlayerCouponEligibility",
                columns: new[] { "CampaignId", "PlayerId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PlayerCouponEligibility_CouponId",
                table: "PlayerCouponEligibility",
                column: "CouponId");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerCouponEligibility_RoomId",
                table: "PlayerCouponEligibility",
                column: "RoomId");

            migrationBuilder.AddForeignKey(
                name: "FK_Coupons_CouponCampaigns_CampaignId",
                table: "Coupons",
                column: "CampaignId",
                principalTable: "CouponCampaigns",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Coupons_CouponCampaigns_CampaignId",
                table: "Coupons");

            migrationBuilder.DropTable(
                name: "CouponCampaignProducts");

            migrationBuilder.DropTable(
                name: "CouponEvents");

            migrationBuilder.DropTable(
                name: "PlayerCouponEligibility");

            migrationBuilder.DropTable(
                name: "CouponCampaigns");

            migrationBuilder.DropIndex(
                name: "IX_Coupons_CampaignId_BrowserKey",
                table: "Coupons");

            migrationBuilder.DropIndex(
                name: "IX_Coupons_CampaignId_Email",
                table: "Coupons");

            migrationBuilder.DropIndex(
                name: "IX_Coupons_CampaignId_PlayerId",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "BrowserKey",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "CampaignId",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "CancelledAt",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "CancelledBy",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "Email",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "EmailAttempts",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "EmailLastAttemptAt",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "EmailLastError",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "EmailMessageId",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "EmailSentAt",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "EmailStatus",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "FinalScore",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "PlayerId",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "RoomId",
                table: "Coupons");
        }
    }
}
