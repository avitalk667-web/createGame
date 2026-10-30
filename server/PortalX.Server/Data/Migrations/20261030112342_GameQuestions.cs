using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class GameQuestions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GameQuestionRevisions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    QuestionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Action = table.Column<string>(type: "text", nullable: false),
                    BeforeJson = table.Column<string>(type: "jsonb", nullable: true),
                    AfterJson = table.Column<string>(type: "jsonb", nullable: false),
                    Admin = table.Column<string>(type: "text", nullable: false),
                    At = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GameQuestionRevisions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "GameQuestions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ScenarioId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    PuzzleId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Zone = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Question = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Answer = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    AcceptJson = table.Column<string>(type: "jsonb", nullable: false),
                    Category = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Difficulty = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Points = table.Column<int>(type: "integer", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GameQuestions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GameQuestionRevisions_QuestionId_At",
                table: "GameQuestionRevisions",
                columns: new[] { "QuestionId", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_GameQuestions_ScenarioId_PuzzleId_SortOrder",
                table: "GameQuestions",
                columns: new[] { "ScenarioId", "PuzzleId", "SortOrder" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GameQuestionRevisions");

            migrationBuilder.DropTable(
                name: "GameQuestions");
        }
    }
}
