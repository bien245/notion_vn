![](assets\20251208_084304_Group_4.png)

# NotionVN  Notion Quick Add

Ứng dụng giúp kết nối nhanh với Notion để tìm kiếm Database/Page, xem thuộc tính, tạo Page mới, thêm lựa chọn cho thuộc tính multi_select và chèn nội dung vào Page. Ứng dụng gồm server Express và giao diện web tĩnh (views/index.html), có thể đóng gói thành app Android bằng androidjs.

## Tính năng

- **Kiểm tra kết nối**: Gọi `/api/me` để xác thực token nhanh.
- **Tìm kiếm và liệt kê**: Database (`/api/databases`) và Page (`/api/pages`).
- **Tạo Page trong Database** (hỗ trợ icon emoji/external và nội dung ban đầu).
- **Chèn nội dung vào Page**

## Hướng dẫn dùng

1) Tạo dự án notion:
   Truy cập đường link https://www.notion.so/profile/integrations nhất tạo tích hợp mới

   ![](assets\20251208_085340_oke.gif)
2) Chọn các databse và page có thế tích hợp vào (bắt buộc để dùng được )

   ![](assets\20251208_090824_sssss.gif)

   3.Lấy token tích hợp và đưa vào app

   ![](assets\20251208_090638_7303894105774.gif)


## Kiến trúc

- Backend: `main.js` (Express, CORS, dotenv, node-fetch). Port mặc định `3000` (có thể đặt `PORT`).
- Frontend: `views/index.html`, phục vụ tĩnh từ Express.
- Token được lấy theo thứ tự: header `X-Notion-Token`  `process.env.NOTION_TOKEN`  `process.env.NOTION_API_KEY`.
- SDK `@notionhq/client` là tùy chọn; thiếu SDK thì app dùng REST API trực tiếp (Notion-Version `2022-06-28`).

## Yêu cầu

- Node.js 16+ (khuyến nghị 18+)
- npm

## Cài đặt và chạy (Development)

1) Cài phụ thuộc:
   ```bash
   npm install
   ```
2) (Tùy chọn) Tạo `.env` để không cần nhập token trên UI:
   ```env
   NOTION_TOKEN=your-internal-integration-token
   # hoặc: NOTION_API_KEY=...
   PORT=3000
   ```
3) Chạy server:
   ```bash
   npm run start:dev
   ```
4) Mở `http://localhost:3000`.
5) Trên Sidebar, nhập token vào ô "Notion Token"  bấm "Lưu token"  "Kiểm tra" để xác thực.

## Hướng dẫn tạo Notion Integration và lấy token

1) Truy cập https://www.notion.com/my-integrations  Create new integration.
2) Đặt tên, chọn workspace, cấp quyền cần thiết (để tạo/chỉnh sửa cần quyền write).
3) Sao chép "Internal Integration Token"  dán vào ô token trong app hoặc `.env`.
4) Mở Database/Page cần dùng  Share  Invite  chọn integration vừa tạo và cấp quyền.
5) Lấy `database_id`/`page_id`:
   - Có thể dùng toàn bộ URL Notion, server sẽ tự trích 32 ký tự ID (có/không dấu gạch đều được).
   - Ví dụ URL Database: `https://www.notion.so/Workspace/Your-DB-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`.

## Cấu hình token trong ứng dụng

- UI lưu token ở `localStorage` với khóa `NOTION_TOKEN` và `notionToken` để tự động nạp lại.
- Gọi API thủ công: thêm header `X-Notion-Token: <your_token>`.
- Nếu không có header, server sẽ dùng biến môi trường `NOTION_TOKEN`/`NOTION_API_KEY`.

## Tham chiếu API nhanh

- `GET /api/health`  kiểm tra server.
- `GET /api/me`  thông tin tài khoản từ token.
- `GET /api/databases`  liệt kê database.
- `GET /api/pages`  liệt kê page.
- `GET /api/databases/:id/properties`  thuộc tính database.
- `GET /api/databases/:id/raw`  dữ liệu thô database.
- `POST /api/database/create-page`  tạo page trong database:
  - Body: `database_id` (bắt buộc), `title` (tùy chọn), `properties` (object), `content` (string), `icon` ({ type: 'emoji'|'external', ...}).
- `POST /api/pages/append`  chèn nội dung vào page:
  - Body: `page_id`, `text`.
- `POST /api/databases/:id/properties/:propertyId/options`  thêm lựa chọn cho multi_select:
  - Body: `name` (bắt buộc), `color` (default|gray|brown|orange|yellow|green|blue|purple|pink|red).

Lưu ý: Tham số `:id` nhận ID có gạch hoặc 32 ký tự liền, hoặc URL chứa ID.

## Đóng gói Android (androidjs)

Ứng dụng có thể build thành APK bằng `androidjs`.

- Cài CLI:
  ```bash
  npm i -g androidjs
  ```
- Build:
  ```bash
  npm run build
  # tương đương: androidjs build
  ```
- Đầu ra: thư mục `./dist` chứa APK.
- Icon app: `assets/icon/icon.png` (khai báo trong `package.json`).

Ghi chú: Tùy môi trường, có thể cần JDK/Android build tools. Xem tài liệu androidjs khi gặp lỗi build.

## Bảo mật

- Không chia sẻ token. Token lưu cục bộ ở trình duyệt (localStorage).
- Khi dùng máy lạ, xóa token sau khi dùng (xóa nội dung token và bấm Lưu để dọn cache).
- Chỉ cấp quyền integration cho database/page cần thiết.

## Giấy phép

Sử dụng nội bộ/học tập. Điều chỉnh theo nhu cầu dự án.
