package com.teslaskin.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.teslaskin.dto.PageVO;
import com.teslaskin.dto.SkinDetailVO;
import com.teslaskin.dto.SkinItemVO;
import com.teslaskin.dto.UserVO;
import com.teslaskin.entity.CarModel;
import com.teslaskin.entity.Skin;
import com.teslaskin.entity.User;
import com.teslaskin.exception.BizException;
import com.teslaskin.mapper.CarModelMapper;
import com.teslaskin.mapper.SkinMapper;
import com.teslaskin.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class SkinService {

    private static final DateTimeFormatter MONTH_FMT = DateTimeFormatter.ofPattern("yyyyMM");

    private final SkinMapper skinMapper;

    private final CarModelMapper carModelMapper;

    private final UserMapper userMapper;

    private final CropService cropService;

    private final CosService cosService;

    // ==================== 创建（裁剪→上传→落库） ====================

    /**
     * 创建作品：direct=false 走裁剪（用户图 × 车型刀版遮罩）；direct=true 原图即成品，不裁剪
     * designData：前端逐面配图的设计数据 JSON（可选），保存后支持作品修改
     */
    @Transactional
    public SkinDetailVO create(long uid, byte[] sourceBytes, long carModelId, String title,
                               String fileExt, boolean direct, String designData) {
        CarModel model = mustGetModel(carModelId);
        validateImage(sourceBytes);

        byte[] skinBytes;
        String skinKey;
        if (direct) {
            skinBytes = sourceBytes;
            skinKey = "skins/" + model.getCode() + "/" + UUID.randomUUID() + normalizeExt(fileExt);
        } else {
            skinBytes = cropService.crop(sourceBytes, model.getMaskPath());
            skinKey = "skins/" + model.getCode() + "/" + UUID.randomUUID() + ".png";
        }

        // 直接上传时原图即成品，source_key 与 skin_key 指向同一对象，不重复存储
        String sourceKey = direct ? skinKey
                : "source/" + MONTH_FMT.format(LocalDate.now()) + "/" + UUID.randomUUID() + normalizeExt(fileExt);
        if (!direct) {
            cosService.upload(sourceBytes, sourceKey, contentTypeOf(fileExt));
        }
        String skinUrl = cosService.upload(skinBytes, skinKey, direct ? contentTypeOf(fileExt) : "image/png");

        Skin skin = new Skin();
        skin.setUserId(uid);
        skin.setCarModelId(model.getId());
        skin.setTitle(title);
        skin.setSourceKey(sourceKey);
        skin.setSkinKey(skinKey);
        skin.setSkinUrl(skinUrl);
        skin.setFileSize((long) skinBytes.length);
        skin.setStatus(1);
        skin.setDesignData(sanitizeDesignData(designData));
        skinMapper.insert(skin);

        return toDetail(skin, uid);
    }

    /**
     * 修改作品：新成品图 + 标题 + 设计数据覆盖原作品（仅作者可改，状态保持不变）
     */
    @Transactional
    public SkinDetailVO updateMySkin(long uid, long skinId, byte[] skinBytes, long carModelId,
                                     String title, String fileExt, String designData) {
        CarModel model = mustGetModel(carModelId);
        if (title == null || title.isBlank()) {
            throw new BizException(400, "标题不能为空");
        }
        validateImage(skinBytes);
        Skin skin = mustGetSkin(skinId);
        if (!skin.getUserId().equals(uid)) {
            throw new BizException(403, "只能修改自己的作品");
        }

        String skinKey = "skins/" + model.getCode() + "/" + UUID.randomUUID() + normalizeExt(fileExt);
        String skinUrl = cosService.upload(skinBytes, skinKey, "image/png");

        skinMapper.update(null, new LambdaUpdateWrapper<Skin>()
                .eq(Skin::getId, skinId)
                .eq(Skin::getUserId, uid)
                .set(Skin::getCarModelId, model.getId())
                .set(Skin::getTitle, title.trim())
                .set(Skin::getSkinKey, skinKey)
                .set(Skin::getSkinUrl, skinUrl)
                .set(Skin::getFileSize, (long) skinBytes.length)
                .set(Skin::getDesignData, sanitizeDesignData(designData)));

        return toDetail(mustGetSkin(skinId), uid);
    }

    // ==================== 查询 ====================

    public PageVO<SkinItemVO> mine(long uid, long page, long size) {
        // 我的作品：正常(1) 可见；已删除(2) 不返回
        LambdaQueryWrapper<Skin> wrapper = new LambdaQueryWrapper<Skin>()
                .eq(Skin::getUserId, uid)
                .in(Skin::getStatus, 0, 1)
                .orderByDesc(Skin::getCreatedAt);
        Page<Skin> result = skinMapper.selectPage(Page.of(page, Math.min(size, 50)), wrapper);
        List<SkinItemVO> items = enrich(result.getRecords());
        return new PageVO<>(result.getTotal(), result.getPages(), result.getCurrent(), result.getSize(), items);
    }

    public SkinDetailVO detail(long skinId, Long viewerUid) {
        Skin skin = mustGetSkin(skinId);
        long viewer = viewerUid == null ? -1 : viewerUid;
        // 作者本人可查看自己的草稿/下架作品（用于编辑恢复设计数据）；其他人仅可见上架作品
        if (skin.getStatus() != 1 && !skin.getUserId().equals(viewer)) {
            throw new BizException(404, "作品不存在或已删除");
        }
        return toDetail(skin, viewer);
    }

    // ==================== 删除 ====================

    public void delete(long uid, long skinId) {
        Skin skin = mustGetSkin(skinId);
        if (!skin.getUserId().equals(uid)) {
            throw new BizException(403, "只能删除自己的作品");
        }
        skinMapper.update(null, new LambdaUpdateWrapper<Skin>()
                .eq(Skin::getId, skinId)
                .set(Skin::getStatus, 2));
    }

    // ==================== 私有方法 ====================

    private CarModel mustGetModel(long carModelId) {
        CarModel model = carModelMapper.selectById(carModelId);
        if (model == null || model.getStatus() != 1) {
            throw new BizException(404, "车型不存在或未开放");
        }
        return model;
    }

    private Skin mustGetSkin(long skinId) {
        Skin skin = skinMapper.selectById(skinId);
        if (skin == null) {
            throw new BizException(404, "作品不存在");
        }
        return skin;
    }

    /**
     * magic bytes 校验：PNG / JPEG / WebP
     */
    private void validateImage(byte[] bytes) {
        boolean ok = startsWith(bytes, 0x89, 0x50, 0x4E, 0x47)            // PNG
                || startsWith(bytes, (byte) 0xFF, (byte) 0xD8, (byte) 0xFF) // JPEG
                || (bytes.length > 12 && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F'
                    && bytes[3] == 'F' && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P'); // WebP
        if (!ok) {
            throw new BizException(400, "仅支持 PNG / JPG / WebP 图片");
        }
    }

    private boolean startsWith(byte[] bytes, int... prefix) {
        if (bytes.length < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i++) {
            if ((bytes[i] & 0xFF) != prefix[i]) {
                return false;
            }
        }
        return true;
    }

    private String normalizeExt(String ext) {
        if (ext == null || ext.isBlank()) {
            return ".png";
        }
        ext = ext.toLowerCase().trim().replace(".", "");
        return switch (ext) {
            case "jpg", "jpeg" -> ".jpg";
            case "webp" -> ".webp";
            default -> ".png";
        };
    }

    private String contentTypeOf(String ext) {
        return switch (normalizeExt(ext)) {
            case ".jpg" -> "image/jpeg";
            case ".webp" -> "image/webp";
            default -> "image/png";
        };
    }

    /**
     * 批量补齐作者昵称、车型名
     */
    private List<SkinItemVO> enrich(List<Skin> skins) {
        if (skins.isEmpty()) {
            return List.of();
        }
        Set<Long> userIds = skins.stream().map(Skin::getUserId).collect(Collectors.toSet());
        Set<Long> modelIds = skins.stream().map(Skin::getCarModelId).collect(Collectors.toSet());
        Map<Long, User> users = userMapper.selectByIds(userIds).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
        Map<Long, CarModel> models = carModelMapper.selectByIds(modelIds).stream()
                .collect(Collectors.toMap(CarModel::getId, Function.identity()));
        return skins.stream().map(s -> {
            User author = users.get(s.getUserId());
            CarModel model = models.get(s.getCarModelId());
            return new SkinItemVO(s.getId(), s.getTitle(), s.getSkinUrl(), s.getCarModelId(),
                    model == null ? "" : model.getName(),
                    author == null ? "神秘车友" : author.getNickname(), s.getStatus(), s.getCreatedAt(),
                    s.getDesignData() != null && !s.getDesignData().isBlank());
        }).collect(Collectors.toList());
    }

    private SkinDetailVO toDetail(Skin skin, long viewerUid) {
        User author = userMapper.selectById(skin.getUserId());
        CarModel model = carModelMapper.selectById(skin.getCarModelId());
        return new SkinDetailVO(skin.getId(), skin.getTitle(), skin.getSkinUrl(), skin.getCarModelId(),
                model == null ? "" : model.getName(), skin.getCreatedAt(),
                author == null ? null : UserVO.from(author), skin.getUserId() != null && skin.getUserId() == viewerUid,
                skin.getDesignData());
    }

    /**
     * 设计数据兜底清洗：空值返回 null；超过 1MB 拒绝（防滥用）
     */
    private String sanitizeDesignData(String designData) {
        if (designData == null || designData.isBlank()) {
            return null;
        }
        if (designData.length() > 1024 * 1024) {
            throw new BizException(400, "设计数据过大");
        }
        return designData;
    }
}
