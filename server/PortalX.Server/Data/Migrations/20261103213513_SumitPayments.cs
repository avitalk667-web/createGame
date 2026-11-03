using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class SumitPayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "PaymentEvents",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CheckoutExpiresAt",
                table: "Orders",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastReconciledAt",
                table: "Orders",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PaymentVerifiedAt",
                table: "Orders",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProviderAuthNumber",
                table: "Orders",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "ProviderCustomerId",
                table: "Orders",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "ProviderDocumentId",
                table: "Orders",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "ProviderDocumentNumber",
                table: "Orders",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProviderIssue",
                table: "Orders",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Orders_Provider_ProviderTransactionId",
                table: "Orders",
                columns: new[] { "Provider", "ProviderTransactionId" },
                unique: true,
                filter: "\"Provider\" = 'sumit' AND \"ProviderTransactionId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Orders_Provider_ProviderTransactionId",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "PaymentEvents");

            migrationBuilder.DropColumn(
                name: "CheckoutExpiresAt",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "LastReconciledAt",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "PaymentVerifiedAt",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "ProviderAuthNumber",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "ProviderCustomerId",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "ProviderDocumentId",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "ProviderDocumentNumber",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "ProviderIssue",
                table: "Orders");
        }
    }
}
