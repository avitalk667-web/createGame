using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class TreasureRewards : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CouponCampaigns_Kind",
                table: "CouponCampaigns");

            migrationBuilder.CreateTable(
                name: "TreasureConfigs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    FallbackKey = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PrizesJson = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TreasureConfigs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TreasureGiftProducts",
                columns: table => new
                {
                    ProductId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    AddedBy = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    AddedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TreasureGiftProducts", x => x.ProductId);
                    table.ForeignKey(
                        name: "FK_TreasureGiftProducts_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TreasureWins",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    ConfigId = table.Column<int>(type: "integer", nullable: false),
                    DrawnKey = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PrizeKey = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PrizeKind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    IsFallback = table.Column<bool>(type: "boolean", nullable: false),
                    FallbackReason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    PrizeSnapshotJson = table.Column<string>(type: "jsonb", nullable: false),
                    Roll = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    CouponId = table.Column<Guid>(type: "uuid", nullable: true),
                    EntitlementId = table.Column<Guid>(type: "uuid", nullable: true),
                    GiftProductId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    CostIls = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    IsTest = table.Column<bool>(type: "boolean", nullable: false),
                    RevealedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    EmailSentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TreasureWins", x => x.Id);
                    table.CheckConstraint("CK_TreasureWins_Roll", "\"Roll\" BETWEEN 0 AND 9999");
                    table.ForeignKey(
                        name: "FK_TreasureWins_Coupons_CouponId",
                        column: x => x.CouponId,
                        principalTable: "Coupons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TreasureWins_Entitlements_EntitlementId",
                        column: x => x.EntitlementId,
                        principalTable: "Entitlements",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TreasureWins_Orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TreasureWins_Products_GiftProductId",
                        column: x => x.GiftProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TreasureWins_TreasureConfigs_ConfigId",
                        column: x => x.ConfigId,
                        principalTable: "TreasureConfigs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CouponCampaigns_Kind",
                table: "CouponCampaigns",
                column: "Kind",
                unique: true,
                filter: "\"Kind\" IN ('taste', 'treasure')");

            migrationBuilder.CreateIndex(
                name: "IX_TreasureConfigs_CreatedAt",
                table: "TreasureConfigs",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_TreasureConfigs_IsActive",
                table: "TreasureConfigs",
                column: "IsActive",
                unique: true,
                filter: "\"IsActive\"");

            migrationBuilder.CreateIndex(
                name: "IX_TreasureWins_ConfigId",
                table: "TreasureWins",
                column: "ConfigId");

            migrationBuilder.CreateIndex(
                name: "IX_TreasureWins_CouponId",
                table: "TreasureWins",
                column: "CouponId",
                unique: true,
                filter: "\"CouponId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_TreasureWins_CreatedAt",
                table: "TreasureWins",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_TreasureWins_Email",
                table: "TreasureWins",
                column: "Email");

            migrationBuilder.CreateIndex(
                name: "IX_TreasureWins_EntitlementId",
                table: "TreasureWins",
                column: "EntitlementId",
                unique: true,
                filter: "\"EntitlementId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_TreasureWins_GiftProductId",
                table: "TreasureWins",
                column: "GiftProductId");

            migrationBuilder.CreateIndex(
                name: "IX_TreasureWins_OrderId",
                table: "TreasureWins",
                column: "OrderId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TreasureWins_PrizeKey_Status",
                table: "TreasureWins",
                columns: new[] { "PrizeKey", "Status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TreasureGiftProducts");

            migrationBuilder.DropTable(
                name: "TreasureWins");

            migrationBuilder.DropTable(
                name: "TreasureConfigs");

            migrationBuilder.DropIndex(
                name: "IX_CouponCampaigns_Kind",
                table: "CouponCampaigns");

            migrationBuilder.CreateIndex(
                name: "IX_CouponCampaigns_Kind",
                table: "CouponCampaigns",
                column: "Kind",
                unique: true,
                filter: "\"Kind\" = 'taste'");
        }
    }
}
