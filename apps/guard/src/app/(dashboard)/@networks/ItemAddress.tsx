'use client';

import { Amount, Identifier, Stack, Typography } from '@rosen-bridge/ui-kit';
import type { Network as NetworkType } from '@rosen-ui/types';
import { getAddressUrl } from '@rosen-ui/utils';

import type { TokenInfoWithAddress } from '@/types/api';

export type ItemAddressProps = {
  loading?: boolean;
  state: 'hot' | 'cold';
  value?: Omit<TokenInfoWithAddress, 'balance'> & {
    balance: Omit<TokenInfoWithAddress['balance'], 'amount'> & {
      amount: number | bigint;
    };
    addressUrl?: string;
  };
};

export const ItemAddress = ({ loading, state, value }: ItemAddressProps) => {
  return (
    <div style={{ width: '100%' }}>
      <Stack
        direction="row"
        align="center"
        justify="start"
        style={{ fontSize: '1.5rem', width: '100%' }}
      >
        <Typography
          color={`${state === 'hot' ? 'secondary-dark' : 'tertiary-dark'}`}
          component="div"
          fontWeight="700"
          fontSize="1.5rem"
        >
          <Amount
            variant={state}
            loading={loading}
            value={value?.balance.amount}
            decimal={value?.balance.decimals}
            unit={value?.balance.name}
          />
        </Typography>
      </Stack>
      <Identifier
        href={value?.addressUrl ?? getAddressUrl(value?.chain as NetworkType, value?.address)}
        loading={loading}
        value={value?.address}
        fallback="N/A"
        copyable
        qrcode
        style={{ minHeight: '30px' }}
      />
    </div>
  );
};
