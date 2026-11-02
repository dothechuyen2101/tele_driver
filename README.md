# TeleDriver

Biến Telegram thành Google Drive. Lưu file tới 2 GB/file (4 GB với Premium), dung lượng không giới hạn, và quản lý bằng giao diện giống Drive. App chạy 100% trên trình duyệt: kết nối thẳng tới Telegram qua MTProto, không có server trung gian.

## Tính năng

- **Quản lý file**: thư mục, kéo thả (cả file lẫn thư mục từ máy), đổi tên, di chuyển, chọn nhiều, menu chuột phải, phím tắt (`Del`, `F2`, `Enter`, `Ctrl+A`, `/`, `Backspace`), dán ảnh để tải lên.
- **Đăng nhập bằng mã QR** (hỗ trợ xác minh hai bước). Không cần nhập số điện thoại.
- **Xem trực tiếp video/audio** qua Service Worker, tua được, không phải tải cả file về trước. Ảnh, PDF và text xem ngay trong app.
- **File lớn hơn 2 GB** tự động được chia thành nhiều phần 2000 MiB (4000 MiB với Premium) và ghép lại khi tải xuống hoặc xem.
- **Tải nhiều file hoặc cả thư mục dạng ZIP** bằng stream (ZIP64), ghi thẳng xuống đĩa, không giữ trong RAM.
- **Mã hoá đầu-cuối** cho từng thư mục: AES-256-GCM theo chunk, mã hoá cả tên file. Telegram không đọc được nội dung.
- **Khoá bằng passcode**: mã hoá session, API key và khoá vault trong IndexedDB, tự khoá khi không dùng.
- **Thùng rác 30 ngày**, có hoàn tác.
- **Gửi file sang chat khác**: gửi bản sao sạch (không kèm thẻ TeleDriver, không upload lại) hoặc chuyển tiếp thường.
- **Tìm kiếm và lọc**: tìm không phân biệt dấu ("hop dong" khớp "Hợp đồng"), lọc theo loại, kích thước, ngày.
- **Thư mục thông minh**: Ảnh, Video, Âm thanh, Tài liệu, File nén, Khác.
- **Kho lưu trữ**: tạo kênh riêng tư bằng một click, hoặc dùng Saved Messages, kênh hay nhóm có sẵn.
- **PWA**: cài như app; trên Android có thể "Chia sẻ tới TeleDriver" từ app khác.
- **Tiếng Việt / English** tự nhận theo hệ thống. **Giao diện sáng/tối** tự động theo hệ thống.

## Bắt đầu

Cần Node.js 20.19+ (khuyên dùng 22).

```bash
npm install
npm run dev        # http://localhost:5173
```

Mở app, nhập **API ID** và **API Hash** của bạn, rồi quét mã QR bằng Telegram trên điện thoại.

### Lấy API ID / API Hash

1. Mở <https://my.telegram.org/apps> và đăng nhập bằng số điện thoại.
2. Chọn **API development tools**.
3. Tạo ứng dụng: title và short name tuỳ ý, Platform chọn **Web**.
4. Sao chép `App api_id` và `App api_hash`.

Key chỉ được lưu trên trình duyệt của người dùng. Mỗi người dùng nhập key của chính họ.

> Nên dùng thử với tài khoản phụ trước. Telegram có thể đánh dấu những tài khoản dùng API key mới tạo mà tải lên rất nhiều.

## Deploy lên Vercel

Đây là static site, không cần biến môi trường nào.

- **Cách 1:** push repo lên GitHub → <https://vercel.com/new> → Import. Vercel tự nhận cấu hình từ [vercel.json](vercel.json).
- **Cách 2:** dùng CLI: `npx vercel` (preview) hoặc `npx vercel --prod`.

[vercel.json](vercel.json) có sẵn SPA rewrite, `Cache-Control` cho `sw.js` và assets, cùng các header bảo mật (CSP, `X-Frame-Options`, `Referrer-Policy`…). `npm run preview` đọc **chính các header đó** nên CSP được kiểm tra ngay ở local.

## Lệnh

| Lệnh | Việc |
| --- | --- |
| `npm run dev` | Dev server (có Service Worker ở chế độ dev) |
| `npm run build` | Typecheck và build production vào `dist/` |
| `npm run preview` | Chạy bản build với header giống Vercel |
| `npm test` | Unit test (Vitest) |
| `npm run lint` | ESLint |

## Kiến trúc

```
React UI ──useLiveQuery──► IndexedDB (Dexie): cache các tin nhắn của kho lưu trữ
   │                              ▲
   ▼                              │ sync: quét lịch sử + update realtime
drive/ (ops, uploads, downloads, logical, vault) ──► telegram/ (teleproto MTProto qua WSS)
   │
Service Worker: /__td/stream (Range, cho <video>/<audio>), /__td/download, share target, precache PWA
```

- **Telegram là nguồn sự thật.** IndexedDB chỉ là cache, nên mở trên thiết bị khác vẫn thấy đúng cấu trúc.
- **Upload** đọc file bằng `File.slice()` theo từng phần 512 KiB và đẩy song song qua nhiều kết nối, không nạp cả file vào RAM.
- **Download và stream** đọc theo byte-range (`upload.getFile`). File reference hết hạn sẽ được làm mới tự động.
- **Thư viện MTProto:** [teleproto](https://www.npmjs.com/package/teleproto), fork đang được bảo trì của GramJS (bản gốc đã ngừng phát triển).

### Thư mục được lưu ở đâu?

Telegram không có khái niệm thư mục, nên TeleDriver ghi một dòng thẻ ở cuối tin nhắn hoặc caption:

```
#td_dir v=1 p=root n=Công%20việc          ← thư mục; ID của nó chính là message id
#td v=1 f=1234                            ← file nằm trong thư mục 1234
#td v=1 f=root g=k3j9 i=2/3 n=… ts=…      ← phần 2/3 của một file lớn
#td v=1 f=88 e=… x=… en=… sz=…            ← file mã hoá (khoá đã bọc, nonce, tên đã mã hoá)
#td_patch v=1 m=5678 f=1234               ← ghi đè trường của tin 5678 khi không sửa được tin gốc
#td_vault v=1 s=… it=600000 w=…           ← vault mã hoá đầu-cuối
```

- Đổi tên hoặc di chuyển thư mục chỉ cần sửa một tin nhắn.
- Ảnh và file có sẵn mà không có thẻ sẽ hiện ở thư mục gốc.
- Khi Telegram không cho sửa tin (tin chuyển tiếp, tin cũ trong nhóm), thay đổi được ghi bằng một tin `#td_patch`.

### Mã hoá đầu-cuối

- Mật khẩu → PBKDF2-SHA256 (600k vòng) → khoá AES-KW, dùng để bọc **khoá vault** (lưu trong tin `#td_vault`).
- Khoá vault bọc **khoá riêng của từng file**. Vì vậy đổi mật khẩu chỉ cần sửa một tin nhắn.
- File được mã hoá AES-256-GCM theo chunk: mỗi chunk plaintext 1 MiB − 16 B thành đúng 1 MiB ciphertext, khớp với block tải của Telegram. Nhờ vậy vẫn tua video và đọc ngẫu nhiên được trên file mã hoá.
- IV = nonce của file ‖ chỉ số chunk. AAD = chỉ số chunk ‖ cờ chunk cuối, để chống đảo hoặc cắt chunk.
- **Không có cách khôi phục mật khẩu đã quên.**

### Bảo mật

- Session Telegram cho toàn quyền vào tài khoản. Nó chỉ nằm trong IndexedDB của trình duyệt; nếu bật passcode thì được mã hoá AES-GCM.
- CSP chặt: script chỉ từ chính site (`wasm-unsafe-eval` chỉ để chạy WASM crypto của MTProto, không cho JS `eval`), và chỉ được kết nối tới `wss://*.web.telegram.org`.
- Service Worker chỉ phát inline audio/video. Mọi loại khác bị ép thành tệp tải về, kèm `Content-Security-Policy: sandbox`, để file HTML độc hại không chạy được trong origin của app.

## Giới hạn

- Download và stream qua Service Worker cần **giữ tab mở**. Lần đầu mở trang, nếu SW chưa sẵn sàng, file lớn hơn 512 MB cần tải lại trang.
- Trong nhóm, thành viên khác thấy được file. Khuyên dùng kênh riêng tư hoặc Saved Messages.
- Thumbnail của file mã hoá chỉ có trên thiết bị đã tải file đó lên.
- Telegram có thể yêu cầu chậm lại (FLOOD_WAIT) khi di chuyển hay xoá hàng nghìn file cùng lúc. App sẽ tự chờ.

## Kiểm thử

- `npm test`: metadata, dựng cây thư mục, chia part, mã hoá chunk (kể cả chống đảo/cắt chunk), vault và đổi mật khẩu.
- Đã kiểm tra trên Chrome headless:
  - Kết nối MTProto thật tới Telegram qua WebSocket, ở cả dev và production, dưới CSP thật.
  - SW stream trả đúng từng byte với Range và suffix-range; chặn HTML inline.
  - Giao diện lưới, danh sách, tìm kiếm, thùng rác, cài đặt và mobile.
- Luồng có tài khoản thật (đăng nhập, upload/download, mã hoá) cần kiểm thử thủ công với API key của bạn.
