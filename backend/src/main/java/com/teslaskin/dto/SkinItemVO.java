package com.teslaskin.dto;

import java.time.LocalDateTime;

/**
 * 皮肤列表项
 */
public record SkinItemVO(Long id, String title, String skinUrl, Long carModelId, String carModelName,
                         String authorNickname, Integer status, LocalDateTime createdAt, boolean hasDesign) {
}
