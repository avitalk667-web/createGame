using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PortalX.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class FreeGameCoverArt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // the free game gets its poster on the home page; a cover the admin already changed is kept
            migrationBuilder.Sql("UPDATE \"Products\" SET \"CoverImage\" = 'img/sample/cover-art.webp' WHERE \"Id\" = 'gate-of-secrets' AND \"CoverImage\" = 'img/sample/cover.jpg';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("UPDATE \"Products\" SET \"CoverImage\" = 'img/sample/cover.jpg' WHERE \"Id\" = 'gate-of-secrets' AND \"CoverImage\" = 'img/sample/cover-art.webp';");
        }
    }
}
