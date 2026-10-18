package com.teslaskin.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.teslaskin.dto.ApiResponse;
import com.teslaskin.entity.CarModel;
import com.teslaskin.exception.BizException;
import com.teslaskin.mapper.CarModelMapper;
import com.teslaskin.service.CropService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/api/v1/car-models")
@RequiredArgsConstructor
public class CarModelController {

    private final CarModelMapper carModelMapper;

    private final CropService cropService;

    public record CarModelVO(Long id, String code, String name, String previewUrl) {
    }

    /** 刀版面：模板坐标系下的包围盒 + 自动推断的部位名 */
    public record FaceVO(int index, int x, int y, int w, int h, String name) {
    }

    @GetMapping
    public ApiResponse<List<CarModelVO>> list() {
        List<CarModel> models = carModelMapper.selectList(new LambdaQueryWrapper<CarModel>()
                .eq(CarModel::getStatus, 1)
                .orderByAsc(CarModel::getSortOrder));
        List<CarModelVO> vos = models.stream()
                .map(m -> new CarModelVO(m.getId(), m.getCode(), m.getName(), m.getPreviewUrl()))
                .toList();
        return ApiResponse.ok(vos);
    }

    /**
     * 刀版面列表：逐面编辑器用（每个面单独配图）
     * name 基于面包围盒中心在整车中的相对位置自动推断（左上/正上/右上/左中/正中/右中/左下/正下/右下）+ 同区域序号
     * index 保持原始栅格序号（与 /faces/{index}/mask 对应）；显示顺序按 y→x 排序
     */
    @GetMapping("/{id}/faces")
    public ApiResponse<List<FaceVO>> faces(@PathVariable long id) {
        CarModel model = mustGetModel(id);
        List<int[]> boxes = cropService.faceBoxes(model.getMaskPath());
        int totalW = model.getMaskWidth() != null ? model.getMaskWidth() : 1024;
        int totalH = model.getMaskHeight() != null ? model.getMaskHeight() : 1024;
        // 排序原始索引（不改变 boxes 本身）：按 y→x 顺序符合阅读习惯
        List<Integer> order = new ArrayList<>(boxes.size());
        for (int i = 0; i < boxes.size(); i++) {
            order.add(i);
        }
        final List<int[]> finalBoxes = boxes;
        order.sort((a, b) -> {
            int[] ba = finalBoxes.get(a);
            int[] bb = finalBoxes.get(b);
            int ya = ba[1] + ba[3] / 2;
            int yb = bb[1] + bb[3] / 2;
            if (Math.abs(ya - yb) > totalH * 0.05) {
                return Integer.compare(ya, yb);
            }
            return Integer.compare(ba[0] + ba[2] / 2, bb[0] + bb[2] / 2);
        });
        // 同区域计数器：key = 区域名（"左上"/"正上"...）
        java.util.Map<String, int[]> regionCount = new java.util.HashMap<>();
        List<FaceVO> vos = new ArrayList<>(order.size());
        for (int i = 0; i < order.size(); i++) {
            int origIdx = order.get(i);
            int[] b = boxes.get(origIdx);
            String region = regionName(b, totalW, totalH);
            int[] cnt = regionCount.computeIfAbsent(region, k -> new int[]{0});
            cnt[0]++;
            String name = cnt[0] > 1 ? region + cnt[0] : region;
            vos.add(new FaceVO(origIdx, b[0], b[1], b[2], b[3], name));
        }
        return ApiResponse.ok(vos);
    }

    /**
     * 包围盒中心点在整车中的相对位置 → 区域名
     */
    private String regionName(int[] box, int totalW, int totalH) {
        int cx = box[0] + box[2] / 2;
        int cy = box[1] + box[3] / 2;
        String v;
        if (cy < totalH * 0.33) {
            v = "上";
        } else if (cy < totalH * 0.66) {
            v = "中";
        } else {
            v = "下";
        }
        String h;
        if (cx < totalW * 0.33) {
            h = "左";
        } else if (cx < totalW * 0.66) {
            h = "正";
        } else {
            h = "右";
        }
        if ("正".equals(h) && "中".equals(v)) {
            return "正中";
        }
        return h + v;
    }

    /**
     * 单面遮罩图：该面形状（纯白 + alpha，域外透明），前端裁剪形状与合成用
     */
    @GetMapping("/{id}/faces/{index}/mask")
    public ResponseEntity<byte[]> faceMask(@PathVariable long id, @PathVariable int index) {
        CarModel model = mustGetModel(id);
        byte[] png = cropService.faceMask(model.getMaskPath(), index);
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_PNG)
                .cacheControl(CacheControl.maxAge(Duration.ofDays(30)))
                .body(png);
    }

    /**
     * 完整遮罩图：templates/mask 中的原遮罩 PNG（带 alpha），前端逐面配图整车 silhouette 用。
     * 保证与原遮罩资产完全一致，避免逐面 mask 合成时的坐标/缺图偏差。
     */
    @GetMapping("/{id}/full-mask")
    public ResponseEntity<byte[]> fullMask(@PathVariable long id) {
        CarModel model = mustGetModel(id);
        byte[] png = cropService.fullMask(model.getMaskPath());
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_PNG)
                .cacheControl(CacheControl.maxAge(Duration.ofDays(30)))
                .body(png);
    }

    private CarModel mustGetModel(long id) {
        CarModel model = carModelMapper.selectById(id);
        if (model == null || model.getStatus() != 1) {
            throw new BizException(404, "车型不存在或未开放");
        }
        return model;
    }
}
