using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class ProductPreviousPrice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "PreviousPriceIls",
                table: "Products",
                type: "numeric(10,2)",
                precision: 10,
                scale: 2,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Products_PreviousPrice",
                table: "Products",
                sql: "\"PreviousPriceIls\" IS NULL OR (\"PriceIls\" IS NOT NULL AND \"PreviousPriceIls\" > \"PriceIls\")");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Products_PreviousPrice",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "PreviousPriceIls",
                table: "Products");
        }
    }
}
