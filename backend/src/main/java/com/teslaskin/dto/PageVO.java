package com.teslaskin.dto;

import java.util.List;

public record PageVO<T>(long total, long pages, long current, long size, List<T> list) {
}
