using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class NewsletterClickTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NewsletterLinks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IssueId = table.Column<Guid>(type: "uuid", nullable: false),
                    Slot = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Category = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Label = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Destination = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NewsletterLinks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_NewsletterLinks_NewsletterIssues_IssueId",
                        column: x => x.IssueId,
                        principalTable: "NewsletterIssues",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NewsletterTrackers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IssueId = table.Column<Guid>(type: "uuid", nullable: false),
                    DeliveryId = table.Column<long>(type: "bigint", nullable: true),
                    IsTest = table.Column<bool>(type: "boolean", nullable: false),
                    TestEmail = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NewsletterTrackers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_NewsletterTrackers_NewsletterDeliveries_DeliveryId",
                        column: x => x.DeliveryId,
                        principalTable: "NewsletterDeliveries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NewsletterTrackers_NewsletterIssues_IssueId",
                        column: x => x.IssueId,
                        principalTable: "NewsletterIssues",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NewsletterClickEvents",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    IssueId = table.Column<Guid>(type: "uuid", nullable: false),
                    TrackerId = table.Column<Guid>(type: "uuid", nullable: false),
                    DeliveryId = table.Column<long>(type: "bigint", nullable: true),
                    LinkId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClickedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UserAgent = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    IsTest = table.Column<bool>(type: "boolean", nullable: false),
                    IsAutomated = table.Column<bool>(type: "boolean", nullable: false),
                    AutomatedReason = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    AttributionHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NewsletterClickEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_NewsletterClickEvents_NewsletterIssues_IssueId",
                        column: x => x.IssueId,
                        principalTable: "NewsletterIssues",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NewsletterClickEvents_NewsletterLinks_LinkId",
                        column: x => x.LinkId,
                        principalTable: "NewsletterLinks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NewsletterClickEvents_NewsletterTrackers_TrackerId",
                        column: x => x.TrackerId,
                        principalTable: "NewsletterTrackers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NewsletterOrderAttributions",
                columns: table => new
                {
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    IssueId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClickId = table.Column<long>(type: "bigint", nullable: false),
                    DeliveryId = table.Column<long>(type: "bigint", nullable: true),
                    ClickedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AttributedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NewsletterOrderAttributions", x => x.OrderId);
                    table.ForeignKey(
                        name: "FK_NewsletterOrderAttributions_NewsletterClickEvents_ClickId",
                        column: x => x.ClickId,
                        principalTable: "NewsletterClickEvents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NewsletterOrderAttributions_NewsletterIssues_IssueId",
                        column: x => x.IssueId,
                        principalTable: "NewsletterIssues",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NewsletterOrderAttributions_Orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterClickEvents_AttributionHash",
                table: "NewsletterClickEvents",
                column: "AttributionHash");

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterClickEvents_DeliveryId",
                table: "NewsletterClickEvents",
                column: "DeliveryId");

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterClickEvents_IssueId_ClickedAt",
                table: "NewsletterClickEvents",
                columns: new[] { "IssueId", "ClickedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterClickEvents_LinkId",
                table: "NewsletterClickEvents",
                column: "LinkId");

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterClickEvents_TrackerId_ClickedAt",
                table: "NewsletterClickEvents",
                columns: new[] { "TrackerId", "ClickedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterLinks_IssueId_Kind",
                table: "NewsletterLinks",
                columns: new[] { "IssueId", "Kind" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterLinks_IssueId_Slot",
                table: "NewsletterLinks",
                columns: new[] { "IssueId", "Slot" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterOrderAttributions_ClickId",
                table: "NewsletterOrderAttributions",
                column: "ClickId");

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterOrderAttributions_IssueId",
                table: "NewsletterOrderAttributions",
                column: "IssueId");

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterTrackers_DeliveryId",
                table: "NewsletterTrackers",
                column: "DeliveryId");

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterTrackers_IssueId",
                table: "NewsletterTrackers",
                column: "IssueId");

            migrationBuilder.CreateIndex(
                name: "IX_NewsletterTrackers_TokenHash",
                table: "NewsletterTrackers",
                column: "TokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NewsletterOrderAttributions");

            migrationBuilder.DropTable(
                name: "NewsletterClickEvents");

            migrationBuilder.DropTable(
                name: "NewsletterLinks");

            migrationBuilder.DropTable(
                name: "NewsletterTrackers");
        }
    }
}
