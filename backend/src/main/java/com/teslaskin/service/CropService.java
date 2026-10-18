package com.teslaskin.service;

import com.teslaskin.exception.BizException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.AlphaComposite;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * 裁剪引擎：用户图 cover-fit 到 1024x1024 后，以刀版遮罩 alpha 通道为形状做 SrcIn 合成。
 * 输出 = 用户图颜色 × 遮罩形状（碎片间保持透明间隙）。
 */
@Slf4j
@Service
public class CropService {

    public static final int OUTPUT_SIZE = 1024;

    /** 面最小像素数下限：仅过滤刀版边缘碎屑（抗锯齿残留/单像素噪点），保留所有真实面（含后视镜/把手） */
    private static final int FACE_MIN_PIXELS_FLOOR = 500;

    /** 面最小像素数占遮罩面积的比例：0 表示不按面积比例过滤 */
    private static final double FACE_MIN_PIXEL_RATIO = 0.0;

    /** 遮罩缓存：key = classpath 路径（如 templates/mask/model3_mask.png） */
    private final ConcurrentMap<String, BufferedImage> maskCache = new ConcurrentHashMap<>();

    /** 刀版面布局缓存：连通域包围盒 + 像素归属标记 */
    private final ConcurrentMap<String, FaceLayout> layoutCache = new ConcurrentHashMap<>();

    /**
     * 刀版面布局：连通域包围盒（栅格序，与 faceMask 编号一致）+ 逐像素归属标记（0=透明，1..n=面编号）
     */
    private record FaceLayout(List<int[]> boxes, int[] labels) {
    }

    /**
     * 核心入口：原图字节 + 遮罩路径 → 1024x1024 透明底 PNG 字节
     */
    public byte[] crop(byte[] sourceBytes, String maskPath) {
        try {
            BufferedImage src = readAsArgb(sourceBytes);
            BufferedImage fitted = coverFit(src, OUTPUT_SIZE, OUTPUT_SIZE);
            BufferedImage masked = applyMask(fitted, getMask(maskPath));
            return encodePng(masked);
        } catch (IOException e) {
            log.warn("图片处理失败: {}", e.getMessage());
            throw new BizException(400, "图片处理失败，请换一张试试");
        }
    }

    /**
     * 解码并统一为 TYPE_INT_ARGB；坏图/不支持格式抛业务异常（TwelveMonkeys 兜底 CMYK JPEG / WebP）
     */
    BufferedImage readAsArgb(byte[] bytes) throws IOException {
        BufferedImage img = ImageIO.read(new ByteArrayInputStream(bytes));
        if (img == null) {
            throw new BizException(400, "不支持的图片格式，请上传 PNG / JPG / WebP");
        }
        if (img.getType() == BufferedImage.TYPE_INT_ARGB) {
            return img;
        }
        BufferedImage argb = new BufferedImage(img.getWidth(), img.getHeight(), BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = argb.createGraphics();
        try {
            g.drawImage(img, 0, 0, null);
        } finally {
            g.dispose();
        }
        return argb;
    }

    /**
     * cover-fit：等比缩放至完全覆盖目标尺寸，再居中裁掉溢出部分
     */
    BufferedImage coverFit(BufferedImage src, int targetW, int targetH) {
        double scale = Math.max(targetW / (double) src.getWidth(), targetH / (double) src.getHeight());
        int sw = (int) Math.ceil(src.getWidth() * scale);
        int sh = (int) Math.ceil(src.getHeight() * scale);

        BufferedImage scaled = new BufferedImage(sw, sh, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = scaled.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.drawImage(src, 0, 0, sw, sh, null);
        } finally {
            g.dispose();
        }
        // 居中裁剪（getSubimage 共享 raster，仅作后续只读源使用）
        return scaled.getSubimage((sw - targetW) / 2, (sh - targetH) / 2, targetW, targetH);
    }

    /**
     * SrcIn 合成：结果 alpha = 遮罩 alpha，颜色 = 用户图颜色
     */
    BufferedImage applyMask(BufferedImage fitted, BufferedImage mask) {
        BufferedImage out = new BufferedImage(OUTPUT_SIZE, OUTPUT_SIZE, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = out.createGraphics();
        try {
            g.drawImage(mask, 0, 0, null);              // Dst = 遮罩形状
            g.setComposite(AlphaComposite.SrcIn);       // Porter-Duff Src-In
            g.drawImage(fitted, 0, 0, null);            // Src = 用户图
        } finally {
            g.dispose();
        }
        return out;
    }

    byte[] encodePng(BufferedImage img) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ImageIO.write(img, "png", baos);
        return baos.toByteArray();
    }

    /**
     * 刀版面列表：每个面返回 {x, y, w, h}（模板坐标），顺序与 faceMask 编号一致
     */
    public List<int[]> faceBoxes(String maskPath) {
        return layout(maskPath).boxes();
    }

    /**
     * 完整遮罩 PNG 字节：直接返回 templates/mask 中的原图（带 alpha），供前端整车 silhouette 用。
     * 与逐面 mask 合成相比，保证与原遮罩资产像素级一致，规避 faceMaskImages 缺失或坐标错位导致的形状偏差。
     */
    public byte[] fullMask(String maskPath) {
        try {
            BufferedImage mask = getMask(maskPath);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ImageIO.write(mask, "png", baos);
            return baos.toByteArray();
        } catch (IOException e) {
            throw new BizException(500, "完整遮罩导出失败: " + maskPath);
        }
    }

    /**
     * 单面遮罩：该连通域独立成图（纯白 + 原 alpha，域外全透明），裁剪到面包围盒尺寸的 PNG 字节。
     * 前端逐面编辑与合成时用它做形状裁剪，避免相邻面在包围盒重叠处互相串色。
     */
    public byte[] faceMask(String maskPath, int faceIndex) {
        FaceLayout layout = layout(maskPath);
        List<int[]> boxes = layout.boxes();
        if (faceIndex < 0 || faceIndex >= boxes.size()) {
            throw new BizException(404, "面不存在: " + faceIndex);
        }
        BufferedImage mask = getMask(maskPath);
        int[] box = boxes.get(faceIndex);
        int[] labels = layout.labels();
        BufferedImage out = new BufferedImage(box[2], box[3], BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < box[3]; y++) {
            for (int x = 0; x < box[2]; x++) {
                int mx = box[0] + x;
                int my = box[1] + y;
                if (labels[my * mask.getWidth() + mx] == faceIndex + 1) {
                    out.setRGB(x, y, (alphaAt(mask, mx, my) << 24) | 0xFFFFFF);
                }
            }
        }
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try {
            ImageIO.write(out, "png", baos);
        } catch (IOException e) {
            throw new BizException(500, "面遮罩生成失败: " + maskPath + "#" + faceIndex);
        }
        return baos.toByteArray();
    }

    /**
     * 遮罩 alpha 连通域分析（4 邻接，alpha>=8 视为不透明），按栅格扫描序编号。
     * 像素数小于 max(FACE_MIN_PIXELS_FLOOR, w*h*FACE_MIN_PIXEL_RATIO) 的碎屑不进面列表，
     * labels 保持 0；用于过滤车门把手、后视镜、A柱等不对应实际车身的细碎遮罩。
     */
    private FaceLayout layout(String maskPath) {
        return layoutCache.computeIfAbsent(maskPath, path -> {
            BufferedImage mask = getMask(path);
            int w = mask.getWidth(), h = mask.getHeight();
            int faceMinPixels = (int) Math.max(FACE_MIN_PIXELS_FLOOR, w * h * FACE_MIN_PIXEL_RATIO);
            boolean[] visited = new boolean[w * h];
            int[] labels = new int[w * h];
            List<int[]> boxes = new ArrayList<>();
            int[] dx = {1, -1, 0, 0};
            int[] dy = {0, 0, 1, -1};
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int i = y * w + x;
                    if (visited[i] || alphaAt(mask, x, y) < 8) {
                        visited[i] = true;
                        continue;
                    }
                    int minX = x, maxX = x, minY = y, maxY = y;
                    List<Integer> pixels = new ArrayList<>();
                    ArrayDeque<Integer> queue = new ArrayDeque<>();
                    queue.add(i);
                    visited[i] = true;
                    while (!queue.isEmpty()) {
                        int p = queue.poll();
                        pixels.add(p);
                        int px = p % w, py = p / w;
                        if (px < minX) minX = px;
                        if (px > maxX) maxX = px;
                        if (py < minY) minY = py;
                        if (py > maxY) maxY = py;
                        for (int d = 0; d < 4; d++) {
                            int nx = px + dx[d], ny = py + dy[d];
                            if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
                                continue;
                            }
                            int ni = ny * w + nx;
                            if (!visited[ni] && alphaAt(mask, nx, ny) >= 8) {
                                visited[ni] = true;
                                queue.add(ni);
                            }
                        }
                    }
                    if (pixels.size() >= faceMinPixels) {
                        int faceNo = boxes.size() + 1;
                        for (int p : pixels) {
                            labels[p] = faceNo;
                        }
                        boxes.add(new int[]{minX, minY, maxX - minX + 1, maxY - minY + 1});
                    }
                }
            }
            return new FaceLayout(boxes, labels);
        });
    }

    private int alphaAt(BufferedImage img, int x, int y) {
        return (img.getRGB(x, y) >>> 24) & 0xFF;
    }

    /**
     * 按遮罩 classpath 路径懒加载缓存
     */
    BufferedImage getMask(String maskPath) {
        return maskCache.computeIfAbsent(maskPath, path -> {
            try (InputStream in = Thread.currentThread().getContextClassLoader().getResourceAsStream(path)) {
                if (in == null) {
                    throw new BizException(500, "车型遮罩资产缺失: " + path);
                }
                return ImageIO.read(in);
            } catch (IOException e) {
                throw new BizException(500, "车型遮罩加载失败: " + path);
            }
        });
    }
}
