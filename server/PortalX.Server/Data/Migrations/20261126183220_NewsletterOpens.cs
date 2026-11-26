using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class NewsletterOpens : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NewsletterOpenEvents",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    IssueId = table.Column<Guid>(type: "uuid", nullable: false),
                    TrackerId = table.Column<Guid>(type: "uuid", nullable: false),
                    DeliveryId = table.Column<long>(type: "bigint", nullable: true),
                    OpenedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UserAgent = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    IsTest = table.Column<bool>(type: "boolean", nullable: false),
                    IsAutomated = table.Column<bool>(type: "boolean", nullable: false),
                    AutomatedReason = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NewsletterOpenEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_NewsletterOpenEvents_NewsletterIssues_IssueId",
                        column: x => x.IssueId,
                        principalTable: "NewsletterIssues",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NewsletterOpenEvents_NewsletterTrackers_TrackerId",
                        column: x => x.TrackerId,
                        principalTable: "NewsletterTrackers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterOpenEvents_DeliveryId",
                table: "NewsletterOpenEvents",
                column: "DeliveryId");

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterOpenEvents_IssueId_OpenedAt",
                table: "NewsletterOpenEvents",
                columns: new[] { "IssueId", "OpenedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterOpenEvents_TrackerId_OpenedAt",
                table: "NewsletterOpenEvents",
                columns: new[] { "TrackerId", "OpenedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NewsletterOpenEvents");
        }
    }
}
