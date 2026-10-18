package com.teslaskin.service;

import com.teslaskin.exception.BizException;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 裁剪引擎单测：使用真实 Model 3 遮罩资产
 */
class CropServiceTest {

    private static final String MASK_PATH = "templates/mask/model3_mask.png";

    private final CropService cropService = new CropService();

    @TempDir
    static Path tempDir;

    static int[] opaquePoint;
    static int[] transparentPoint;

    @BeforeAll
    static void findSamplePoints() throws IOException {
        // 在真实遮罩中定位一个不透明点和一个透明点
        BufferedImage mask = ImageIO.read(
                Thread.currentThread().getContextClassLoader().getResourceAsStream(MASK_PATH));
        assertNotNull(mask, "遮罩资产应存在于 classpath");
        assertEquals(1024, mask.getWidth());
        assertEquals(1024, mask.getHeight());
        opaquePoint = null;
        transparentPoint = null;
        outer:
        for (int y = 0; y < 1024; y += 3) {
            for (int x = 0; x < 1024; x += 3) {
                int alpha = (mask.getRGB(x, y) >>> 24) & 0xFF;
                if (alpha == 255 && opaquePoint == null) {
                    opaquePoint = new int[]{x, y};
                } else if (alpha == 0 && transparentPoint == null) {
                    transparentPoint = new int[]{x, y};
                }
                if (opaquePoint != null && transparentPoint != null) {
                    break outer;
                }
            }
        }
        assertNotNull(opaquePoint, "遮罩应存在不透明点");
        assertNotNull(transparentPoint, "遮罩应存在透明点");
    }

    @Test
    void cropUniformColorSource() throws IOException {
        // 纯红 800x600 源图 → 不透明区应为纯红、透明区 alpha=0
        BufferedImage src = new BufferedImage(800, 600, BufferedImage.TYPE_INT_RGB);
        int red = 0xFFFF0000;
        for (int y = 0; y < 600; y++) {
            for (int x = 0; x < 800; x++) {
                src.setRGB(x, y, red);
            }
        }
        byte[] out = cropService.crop(toPngBytes(src), MASK_PATH);
        BufferedImage result = ImageIO.read(new java.io.ByteArrayInputStream(out));
        assertEquals(1024, result.getWidth());
        assertEquals(1024, result.getHeight());

        int opaque = result.getRGB(opaquePoint[0], opaquePoint[1]);
        assertEquals(255, (opaque >>> 24) & 0xFF, "遮罩不透明区输出应不透明");
        assertEquals(0xFF, (opaque >>> 16) & 0xFF, "颜色应为源图红色 R=255");
        assertEquals(0x00, (opaque >>> 8) & 0xFF);
        assertEquals(0x00, opaque & 0xFF);

        int transparent = result.getRGB(transparentPoint[0], transparentPoint[1]);
        assertEquals(0, (transparent >>> 24) & 0xFF, "遮罩透明区输出应透明");
    }

    @Test
    void cropExtremeAspectRatios() throws IOException {
        BufferedImage vertical = new BufferedImage(400, 3000, BufferedImage.TYPE_INT_RGB);
        BufferedImage horizontal = new BufferedImage(3000, 400, BufferedImage.TYPE_INT_RGB);
        for (BufferedImage src : new BufferedImage[]{vertical, horizontal}) {
            byte[] out = cropService.crop(toPngBytes(src), MASK_PATH);
            BufferedImage result = ImageIO.read(new java.io.ByteArrayInputStream(out));
            assertEquals(1024, result.getWidth());
            assertEquals(1024, result.getHeight());
            assertTrue(hasOpaquePixel(result), "极端宽高比也应有可见内容");
        }
    }

    @Test
    void cropUpscalesSmallImage() throws IOException {
        BufferedImage small = new BufferedImage(50, 50, BufferedImage.TYPE_INT_RGB);
        byte[] out = cropService.crop(toPngBytes(small), MASK_PATH);
        BufferedImage result = ImageIO.read(new java.io.ByteArrayInputStream(out));
        assertEquals(1024, result.getWidth());
    }

    @Test
    void cropInvalidBytesThrows() {
        assertThrows(BizException.class, () -> cropService.crop("not an image".getBytes(), MASK_PATH));
    }

    @Test
    void cropMissingMaskThrows() {
        BufferedImage src = new BufferedImage(100, 100, BufferedImage.TYPE_INT_RGB);
        assertThrows(Exception.class, () -> cropService.crop(toPngBytes(src), "templates/mask/nope_mask.png"));
    }

    /**
     * 输出样张供人工目检：mvn test 后查看 target/crop-sample.png
     */
    @Test
    void writeSampleForManualCheck() throws IOException {
        BufferedImage src = new BufferedImage(1200, 900, BufferedImage.TYPE_INT_RGB);
        // 彩虹渐变测试图
        for (int y = 0; y < 900; y++) {
            for (int x = 0; x < 1200; x++) {
                src.setRGB(x, y, ((x * 255 / 1200) << 16) | ((y * 255 / 900) << 8) | 128);
            }
        }
        byte[] out = cropService.crop(toPngBytes(src), MASK_PATH);
        File sample = tempDir.resolve("crop-sample.png").toFile();
        ImageIO.write(ImageIO.read(new java.io.ByteArrayInputStream(out)), "png", sample);
        assertTrue(sample.length() > 0);
    }

    private boolean hasOpaquePixel(BufferedImage img) {
        for (int y = 0; y < img.getHeight(); y += 5) {
            for (int x = 0; x < img.getWidth(); x += 5) {
                if (((img.getRGB(x, y) >>> 24) & 0xFF) == 255) {
                    return true;
                }
            }
        }
        return false;
    }

    private byte[] toPngBytes(BufferedImage img) throws IOException {
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        ImageIO.write(img, "png", baos);
        return baos.toByteArray();
    }
}
