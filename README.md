# Quizzy – học từ vựng kiểu Quizlet + Cambridge Dictionary

## Chạy ứng dụng

**Cách nhanh nhất:** bấm đúp `Chay-Quizzy.bat`. File này tự kiểm tra Node.js, tự cài thư viện ở lần chạy đầu và tự mở trình duyệt. Giữ cửa sổ đen mở trong lúc học, đóng cửa sổ là tắt Quizzy.

Hoặc chạy bằng lệnh:

Cần Node.js 22.15 trở lên.

```bash
npm install
npm start
```

Mở http://localhost:3000. Cửa sổ dòng lệnh cũng in địa chỉ **mạng LAN** (ví dụ `http://192.168.1.10:3000`) để mở từ máy khác hoặc điện thoại dùng chung Wi-Fi.

> `npm start` chạy `node --use-system-ca` để Node dùng chứng chỉ của Windows. Cờ này cần thiết trên mạng công ty có kiểm tra SSL. Nếu thiếu, mọi tra cứu sẽ báo `fetch failed`.

## Tính năng

- **Học phần**: tạo, sửa, nhập từ văn bản (Tab, dấu phẩy, gạch ngang…), xuất, sao chép.
- **Gợi ý từ khi gõ**, tự điền **phiên âm UK/US**, audio, từ loại, nghĩa tiếng Việt và ví dụ.
- **Hình ảnh**: tìm ảnh miễn phí (Openverse / Wikimedia Commons), tải ảnh từ máy, kéo thả hoặc dán (Ctrl+V) vào ô định nghĩa. Ảnh được lưu trong `data/uploads`.
- **Chế độ học**: Thẻ ghi nhớ (có theo dõi tiến độ, tự phát, trộn thẻ), Học (trắc nghiệm → tự luận theo vòng), Kiểm tra (Đúng/Sai, trắc nghiệm, tự luận, ghép nối), Ghép thẻ (tính giờ), Chính tả (nghe rồi gõ).
- **Bảng IPA**: nguyên âm ngắn/dài, nguyên âm đôi, phụ âm, các âm riêng của giọng Mỹ, kèm mẹo đọc theo âm tiếng Việt. Bấm vào ô để nghe từ ví dụ.
- **Bấm vào phiên âm bất kỳ** (trên thẻ, danh sách, bài học) để xem từ đó được tách thành từng âm: nguyên âm, phụ âm và trọng âm.

## Gửi học phần qua file Excel (không cần đưa app lên mạng)

Cách đơn giản nhất khi giáo viên và học sinh ở hai nơi: mỗi người chạy Quizzy trên máy mình và gửi file cho nhau qua Zalo, email, Drive…

**Giáo viên → học sinh**
1. Mở học phần → **📗 Xuất Excel → File Excel học phần (.xlsx)**. File gồm thuật ngữ, định nghĩa, phiên âm UK/US, từ loại, ví dụ và **hình ảnh**.
   Muốn gửi nhiều học phần cùng lúc: vào **Thư viện → Xuất tất cả ra Excel** (mỗi học phần một trang tính).
2. Gửi file cho học sinh.
3. Học sinh bấm **Nhập file Excel** (ở Trang chủ hoặc Thư viện), hoặc **kéo thả file** vào cửa sổ Quizzy, là học được ngay.

**Soạn thẻ trực tiếp trong Excel:** vào **Thư viện → ⬇ Tải file mẫu** (hoặc dùng file `Mau soan the Quizzy.xlsx` đi kèm). Mỗi dòng là một thẻ. Chỉ bắt buộc cột *Thuật ngữ*. Nếu bỏ trống *Định nghĩa* hoặc *Phiên âm*, Quizzy tự tra phiên âm, audio và nghĩa tiếng Việt sau khi nhập. Có thể chèn ảnh vào cột *Hình ảnh* (Insert → Pictures, đặt ảnh nằm trong ô của dòng đó).

Quizzy cũng đọc được file chỉ có hai cột (cột A là từ, cột B là nghĩa, ví dụ file xuất từ Quizlet) và file `.csv`.

**Học sinh → giáo viên**
- Mở học phần → **📗 Xuất Excel → Kết quả học của tôi**. File gồm số thẻ đã thuộc / đang học / chưa học, trạng thái từng từ (có tô màu), các từ gắn sao, lịch sử điểm kiểm tra, kỷ lục ghép thẻ và kết quả chính tả. Giáo viên chỉ cần mở bằng Excel.

## Giáo viên và học sinh (dùng chung một máy chủ)

1. Mỗi người tạo một tài khoản (tên, vai trò, mã PIN). **Giáo viên** chọn vai trò *Giáo viên*, **học sinh** chọn *Học sinh*.
2. Giáo viên vào **Lớp học → Tạo lớp** và nhận một **mã lớp** gồm 6 ký tự.
3. Học sinh vào **Lớp học**, nhập mã lớp và bấm **Tham gia**.
4. Giáo viên tạo học phần rồi giao cho lớp. Có ba cách: tick lớp ngay trong trình soạn thẻ, bấm **Giao cho lớp** trên trang học phần, hoặc tick học phần trong thẻ lớp.
5. Học sinh thấy học phần trong mục **📌 Được giáo viên giao**. Học sinh chỉ học được, không sửa được, nhưng có thể *Lưu bản sao* về thư viện của mình.
6. Giáo viên bấm **Xem tiến độ học sinh** để xem: số thẻ đã thuộc, điểm kiểm tra gần nhất, kỷ lục ghép thẻ, lần học gần nhất và những từ học sinh còn gặp khó.

Tiến độ, các thẻ gắn sao và điểm số được lưu trên máy chủ, riêng cho từng người.

**Tự cập nhật thời gian thực:** khi giáo viên tạo, sửa hoặc giao học phần, màn hình của học sinh tự làm mới và hiện thông báo, không cần tải lại trang. Bảng tiến độ của giáo viên cũng tự cập nhật khi học sinh đang học. Nếu học sinh đang làm bài hoặc đang gõ, ứng dụng chỉ báo và chờ đến lúc thích hợp mới làm mới.

## Đưa lên Internet (dùng online)

### Cách 1: thử ngay từ máy này, miễn phí (máy phải luôn bật)

```bash
npm start
cloudflared tunnel --url http://localhost:3000
```

`cloudflared` in ra một địa chỉ dạng `https://xxxx.trycloudflare.com`. Gửi địa chỉ đó cho người còn lại. Địa chỉ sẽ đổi mỗi lần chạy lại tunnel.

### Cách 2: chạy cố định trên Railway (khuyên dùng, khoảng 5 USD/tháng)

1. Đưa thư mục này lên một repository GitHub (nên để **private**). `node_modules/` và `data/` đã được bỏ qua sẵn.
2. Vào railway.com → **New Project → Deploy from GitHub repo** → chọn repo. Railway tự nhận `Dockerfile`.
3. Vào service → **Settings → Volumes → Add Volume**, gắn vào đường dẫn **`/data`**. Bước này bắt buộc: thiếu nó, tài khoản và học phần sẽ mất mỗi lần cập nhật.
4. **Settings → Networking → Generate Domain** để nhận địa chỉ dạng `https://quizzy-xxx.up.railway.app`.

Mỗi lần đẩy code mới lên GitHub, Railway tự triển khai lại. Dữ liệu trong `/data` vẫn được giữ.

Các dịch vụ khác chạy Docker và có ổ đĩa bền vững cũng dùng được, ví dụ Fly.io (volume), Render (gói Starter + Disk) hoặc VPS. Cấu hình chung: biến môi trường `QUIZZY_DATA=/data` và một ổ đĩa gắn vào `/data`. Không nên dùng gói miễn phí của Render vì ổ đĩa ở đó bị xóa mỗi lần khởi động lại.

> Bảo mật khi online: đăng nhập sai PIN 5 lần thì tài khoản (và IP đó) bị khóa 10 phút. Dù vậy, nên dùng PIN 6–8 số.

## Về Cambridge Dictionary

Cambridge không có API công khai. Ứng dụng đọc trang `dictionary.cambridge.org` (bản Anh và Anh–Việt) từ phía máy chủ. Trang này được Cloudflare bảo vệ nên thường chặn truy cập tự động (lỗi 403). Khi bị chặn, ứng dụng tự chuyển sang nguồn dự phòng trong 10 phút:

| Dữ liệu | Nguồn chính | Nguồn dự phòng |
|---|---|---|
| Gợi ý từ | Cambridge autocomplete | Datamuse |
| Phiên âm UK/US + audio | Cambridge | Wiktionary (Wikimedia Commons) |
| Định nghĩa, ví dụ | Cambridge | Wiktionary |
| Nghĩa tiếng Việt | Cambridge Anh–Việt | Google Dịch |

Biểu tượng nguồn (Cambridge / Wiktionary) hiện cạnh mỗi kết quả. Nút "Xem trên Cambridge Dictionary" luôn mở trang Cambridge gốc. Nếu không có audio, ứng dụng dùng giọng đọc của trình duyệt.

## Dữ liệu

- `data/db.json`: tài khoản (PIN được băm bằng scrypt), lớp học, học phần, tiến độ.
- `data/uploads/`: ảnh.

Để sao lưu, chỉ cần chép thư mục `data/`. Có thể đổi vị trí dữ liệu bằng biến môi trường `QUIZZY_DATA` và đổi cổng bằng `PORT`.
