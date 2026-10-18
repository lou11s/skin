"""
分块刀版基底图生成器
把整张不透明的车辆基底照片，按 SLIC 超像素 + 腐蚀制造间隙，转成分块 RGBA mask。
每面独立白色块，块间透明（alpha=0），让连通域分析能识别多面。

用法: python3 SplitBaseMask.py <input.png> <output_mask.png> [n_segments] [gap_pixels]
"""
import sys
import numpy as np
from PIL import Image
from skimage.segmentation import slic
from skimage.morphology import binary_erosion
from scipy.ndimage import binary_dilation
from collections import deque


def is_car_safe(arr, bg):
    """与背景色差异足够大视为车身，仅用于补救背景识别时的反向约束"""
    diff = np.abs(arr.astype(int) - bg).sum(axis=2)
    return diff > 100


def split_base_to_mask(input_path, output_path, n_segments=24, gap_pixels=3, min_pixels=500):
    img = Image.open(input_path).convert('RGB')
    arr = np.array(img)
    h, w = arr.shape[:2]

    # 1. 识别背景：4 角颜色作为背景色，先 flood fill 扩散（限制连通，避免误入车身）
    #    若扩散不足 10%，再用全局"接近 4 角颜色" + 形态学膨胀补救（不要求连通）
    corners = np.array([arr[0, 0], arr[0, w - 1], arr[h - 1, 0], arr[h - 1, w - 1]])
    bg = np.median(corners, axis=0)
    is_bg = np.zeros((h, w), dtype=bool)
    visited_bg = np.zeros((h, w), dtype=bool)
    threshold = 30
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    q = deque()
    for sx, sy in seeds:
        if not visited_bg[sy, sx] and np.all(np.abs(arr[sy, sx].astype(int) - bg) < threshold):
            visited_bg[sy, sx] = True
            q.append((sx, sy))
    while q:
        cx, cy = q.popleft()
        is_bg[cy, cx] = True
        for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < w and 0 <= ny < h and not visited_bg[ny, nx]:
                if np.all(np.abs(arr[ny, nx].astype(int) - bg) < threshold):
                    visited_bg[ny, nx] = True
                    q.append((nx, ny))
    bg_ratio = is_bg.sum() / (h * w)
    print(f'  背景: rgb={tuple(int(v) for v in bg)}, flood fill 背景占比 {bg_ratio*100:.1f}%')
    # flood fill 失败（黑底零散、4 角附近背景过小等）：用亮度阈值补救
    # 思路：4 角亮度作为背景亮度参考，所有"接近 4 角亮度"的像素视为背景，
    # 用形态学膨胀连片，并排除明显是车身的像素（颜色差异 > 100）
    if bg_ratio < 0.20:
        bg_brightness = float(np.mean(bg))
        # 全局亮度接近 4 角亮度 ±40 视为背景候选
        brightness = arr.astype(int).mean(axis=2)
        global_bg = np.abs(brightness - bg_brightness) < 40
        # 排除明显是车身的像素（颜色与 4 角差异大）
        global_bg = global_bg & ~is_car_safe(arr, bg)
        # 形态学膨胀把零散背景连成片（半径 12 像素）
        global_bg = binary_dilation(global_bg, iterations=12)
        # 膨胀后可能侵入车身，再次与 is_car_safe 求交
        global_bg = global_bg & ~is_car_safe(arr, bg)
        is_bg = is_bg | global_bg
        bg_ratio = is_bg.sum() / (h * w)
        print(f'  补救后背景占比 {bg_ratio*100:.1f}%')
    is_car = ~is_bg

    # 2. SLIC 超像素分割
    segments = slic(arr, n_segments=n_segments, compactness=10, start_label=0, channel_axis=2)

    # 3. 每个超像素在车身区域腐蚀制造间隙，输出 alpha 通道
    footprint = np.ones((2 * gap_pixels + 1, 2 * gap_pixels + 1), dtype=bool)
    alpha = np.zeros((h, w), dtype=np.uint8)
    kept = 0
    for seg_id in np.unique(segments):
        seg_mask = (segments == seg_id) & is_car
        size = int(seg_mask.sum())
        if size < min_pixels:
            continue
        eroded = binary_erosion(seg_mask, footprint=footprint)
        if eroded.sum() < min_pixels // 2:
            continue
        alpha[eroded] = 255
        kept += 1
    print(f'  超像素保留: {kept}')

    # 4. 连通域分析验证
    visited = np.zeros((h, w), dtype=bool)
    sizes = []
    for y in range(h):
        for x in range(w):
            if visited[y, x] or alpha[y, x] < 8:
                visited[y, x] = True
                continue
            q = deque([(x, y)])
            visited[y, x] = True
            cnt = 0
            while q:
                cx, cy = q.popleft()
                cnt += 1
                for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and not visited[ny, nx] and alpha[ny, nx] >= 8:
                        visited[ny, nx] = True
                        q.append((nx, ny))
            if cnt >= min_pixels:
                sizes.append(cnt)
    print(f'  连通域数: {len(sizes)}')

    # 5. 输出 RGBA mask：纯白 + alpha
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0:3] = 255
    rgba[..., 3] = alpha
    Image.fromarray(rgba, 'RGBA').save(output_path)
    print(f'  输出: {output_path} 尺寸 {w}x{h}')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('用法: python3 SplitBaseMask.py <input.png> <output_mask.png> [n_segments] [gap_pixels]')
        sys.exit(1)
    n_seg = int(sys.argv[3]) if len(sys.argv) > 3 else 24
    gap = int(sys.argv[4]) if len(sys.argv) > 4 else 3
    print(f'处理: {sys.argv[1]} n_segments={n_seg} gap={gap}')
    split_base_to_mask(sys.argv[1], sys.argv[2], n_segments=n_seg, gap_pixels=gap)
