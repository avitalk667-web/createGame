using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class TasteCoupons : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "DemoSessionId",
                table: "Coupons",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "CouponCampaigns",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "challenge-240");

            migrationBuilder.CreateIndex(
                name: "IX_Coupons_DemoSessionId",
                table: "Coupons",
                column: "DemoSessionId",
                unique: true,
                filter: "\"DemoSessionId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CouponCampaigns_Kind",
                table: "CouponCampaigns",
                column: "Kind",
                unique: true,
                filter: "\"Kind\" = 'taste'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Coupons_DemoSessionId",
                table: "Coupons");

            migrationBuilder.DropIndex(
                name: "IX_CouponCampaigns_Kind",
                table: "CouponCampaigns");

            migrationBuilder.DropColumn(
                name: "DemoSessionId",
                table: "Coupons");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "CouponCampaigns");
        }
    }
}
