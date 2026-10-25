# Yoto Card Studio

**線上版：<https://graysonchiang.github.io/yoto-dashboard/>**（第一次使用要先申請自己的 Client ID，見下方）

在瀏覽器裡管理 Yoto「Make Your Own」playlist 的小工具：

- 拖入 mp3 或選整個資料夾，一鍵上傳成 MYO playlist（同一個檔案不會重複上傳）
- 每首歌選圖示：Yoto 官方圖示庫，或上傳自己的圖片（自動縮成 16×16）
- 封面自動轉成 Yoto App 的 5:8 直式比例（638×1011），不會被拉伸
- 列印卡片貼紙：悠遊卡尺寸模切貼紙（A4 8 格，[要買的貼紙](#要買哪一種貼紙)）或一般 A4 九宮格，含出血、裁切標記與印表機校正

全部在你的瀏覽器裡執行，直接呼叫 Yoto 官方 API（https://yoto.dev）。沒有後端伺服器，你的 Yoto 登入資料、Client ID 都只存在你的瀏覽器。

> 本專案與 Yoto 無關，非官方工具。請只上傳你有權使用的內容。

## 第一次使用：申請自己的 Client ID

這個工具**不內建** Client ID，每個人要用自己的（免費，約 3 分鐘）：

1. 到 [dashboard.yoto.dev](https://dashboard.yoto.dev) 用你的 Yoto 帳號登入，建立一個 **Public** client。
2. **Redirect URL** 填工具網址同一層的 `callback.html`，例如：
   `https://graysonchiang.github.io/yoto-dashboard/callback.html`
   （自己 fork 部署的話是 `https://<GitHub 帳號>.github.io/<repo 名稱>/callback.html`）
   （按「登入 Yoto」時跳出的設定視窗會顯示正確網址，可以直接複製。）
3. **Scopes** 勾選 `user:content:view`、`user:content:manage`、`user:icons:manage`、`offline_access`，然後按**儲存**。
4. 回到工具按「登入 Yoto」，貼上 Client ID。之後會記在瀏覽器裡。

想換 Client ID：在「登入 Yoto」按鈕上按右鍵。

## 瀏覽器

建議用 Chrome 或 Edge。上傳大量音檔時請讓分頁保持在前景（背景分頁會被瀏覽器節流）。

## 列印貼紙

在「Print」分頁選版型、勾選要印的 playlist（每個一張），卡片會排進右邊的畫布，可以拖曳換位置；要接著用印過一半的貼紙，把卡片拖到還沒用過的格子就好。

列印時請選：紙張 A4、方向照提示、縮放「實際大小／100%」、邊界「無」、勾選「背景圖形」。模切貼紙第一次使用請先印「校正頁」，疊在貼紙上對光看有沒有對齊，偏了再輸入位移。

### 要買哪一種貼紙

| 版型 | 用什麼紙 |
|---|---|
| 悠遊卡模切貼紙 8 格（建議） | **[蝦皮這款悠遊卡尺寸模切貼紙](https://shopee.tw/product/1228844109/27958401501)**：A4 一張 8 格，每格 54 × 85.6 mm，跟 Yoto 卡一樣大，撕下來直接貼。版型的格子座標就是照這款量的 |
| 一般 A4 貼紙（3×3） | 任何 A4 整張背膠貼紙，印好沿裁切標記自己剪 |

換成別家的模切貼紙，就算每格尺寸一樣，格子位置也可能不同，記得先印校正頁對過再印。

## 自己部署

這個 repo 就是整個網站（純 HTML + ES modules，不用打包）。Fork 之後到 **Settings → Pages → Build and deployment** 選 **GitHub Actions**，push 到 `main` 就會自動部署。

本機測試：在資料夾裡跑任何靜態 server，例如 `python3 -m http.server 8000`，再到 dashboard.yoto.dev 多登記一個 `http://localhost:8000/callback.html`。
