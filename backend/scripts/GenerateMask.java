import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;

/**
 * 刀版遮罩预处理（一次性工具）：
 * 参考图逐像素转 纯白 + 原alpha（剥离原素材颜色），alpha<8 置 0 防背景残留。
 * 运行：java scripts/GenerateMask.java <参考图.png> <输出遮罩.png>
 */
public class GenerateMask {

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("用法: java scripts/GenerateMask.java <input.png> <output.png>");
            System.exit(1);
        }
        BufferedImage src = ImageIO.read(new File(args[0]));
        if (src == null) {
            System.err.println("无法读取图片: " + args[0]);
            System.exit(1);
        }
        int w = src.getWidth(), h = src.getHeight();
        BufferedImage mask = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        int cleared = 0;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int alpha = (src.getRGB(x, y) >>> 24) & 0xFF;
                if (alpha < 8) {
                    alpha = 0;
                    cleared++;
                }
                mask.setRGB(x, y, (alpha << 24) | 0xFFFFFF); // 纯白 + alpha
            }
        }
        File out = new File(args[1]);
        out.getParentFile().mkdirs();
        ImageIO.write(mask, "png", out);
        System.out.println("遮罩已生成: " + out.getAbsolutePath()
                + " 尺寸=" + w + "x" + h + " 清除微透明像素=" + cleared);
    }
}
