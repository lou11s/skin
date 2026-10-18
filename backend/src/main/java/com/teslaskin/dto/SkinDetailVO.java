package com.teslaskin.dto;

import java.time.LocalDateTime;

/**
 * 皮肤详情
 */
public record SkinDetailVO(Long id, String title, String skinUrl, Long carModelId, String carModelName,
                           LocalDateTime createdAt, UserVO author, boolean mine, String designData) {
}
