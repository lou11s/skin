package com.teslaskin.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.teslaskin.dto.CutoutVO;
import com.teslaskin.entity.UserCutout;
import com.teslaskin.exception.BizException;
import com.teslaskin.mapper.UserCutoutMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 用户抠图库：上传原图抠图入库，配图时选用
 */
@Service
@RequiredArgsConstructor
public class CutoutService {

    private final UserCutoutMapper cutoutMapper;
    private final CosService cosService;

    /**
     * 上传入库：portrait/product 走云端抠图；plain 为已抠好的透明图，免抠直存
     */
    public CutoutVO create(long uid, byte[] bytes, String contentType, String type) {
        String cosKey;
        String finalType;
        if ("plain".equalsIgnoreCase(type)) {
            String uid12 = java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 12);
            cosKey = "matting/plain-" + uid12 + ".png";
            cosService.upload(bytes, cosKey, "image/png");
            finalType = "plain";
        } else {
            boolean portrait = !"product".equalsIgnoreCase(type);
            CosService.MattingResult result = cosService.matting(bytes, contentType, portrait);
            cosKey = result.key();
            finalType = portrait ? "portrait" : "product";
        }
        UserCutout cutout = new UserCutout();
        cutout.setUserId(uid);
        cutout.setType(finalType);
        cutout.setCosKey(cosKey);
        cutout.setImageUrl(cosService.publicUrl(cosKey));
        cutoutMapper.insert(cutout);
        return toVO(cutout);
    }

    /**
     * 我的抠图列表（新 → 旧）
     */
    public List<CutoutVO> list(long uid) {
        return cutoutMapper.selectList(new LambdaQueryWrapper<UserCutout>()
                        .eq(UserCutout::getUserId, uid)
                        .orderByDesc(UserCutout::getId))
                .stream().map(this::toVO).toList();
    }

    /**
     * 删除抠图：删记录 + 尽力清理 COS 对象（已配到面上的照片是本地临时文件，不受影响）
     */
    public void remove(long uid, long id) {
        UserCutout cutout = cutoutMapper.selectById(id);
        if (cutout == null || cutout.getUserId() != uid) {
            throw new BizException(404, "抠图不存在");
        }
        cutoutMapper.deleteById(id);
        cosService.delete(cutout.getCosKey());
    }

    private CutoutVO toVO(UserCutout cutout) {
        return new CutoutVO(cutout.getId(), cutout.getType(), cutout.getImageUrl(), cutout.getCreatedAt());
    }
}
