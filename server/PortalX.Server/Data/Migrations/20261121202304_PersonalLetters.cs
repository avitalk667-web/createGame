using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class PersonalLetters : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PersonalLetters",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    Round = table.Column<int>(type: "integer", nullable: false),
                    SenderPlayerId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipientPlayerId = table.Column<Guid>(type: "uuid", nullable: true),
                    BodySealed = table.Column<string>(type: "character varying(24000)", maxLength: 24000, nullable: false),
                    ClientLetterId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeliveredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    OpenedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PersonalLetters", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PersonalLetters_Rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "Rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PersonalLetters_RecipientPlayerId",
                table: "PersonalLetters",
                column: "RecipientPlayerId");

            migrationBuilder.CreateIndex(
                name: "IX_PersonalLetters_RoomId_Round_SenderPlayerId",
                table: "PersonalLetters",
                columns: new[] { "RoomId", "Round", "SenderPlayerId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PersonalLetters");
        }
    }
}
