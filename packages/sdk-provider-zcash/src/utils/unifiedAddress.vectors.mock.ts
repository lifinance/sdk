// From zcash/zcash-test-vectors: test-vectors/zcash/unified_address.json and f4jumble.json.

/** Each unified address and whether the API pays it: an Orchard receiver and no unknown typecode. */
export const unifiedAddressVectors: { address: string; payable: boolean }[] = [
  {
    address:
      'u1l8xunezsvhq8fgzfl7404m450nwnd76zshscn6nfys7vyz2ywyh4cc5daaq0c7q2su5lqfh23sp7fkf3kt27ve5948mzpfdvckzaect2jtte308mkwlycj2u0eac077wu70vqcetkxf',
    payable: false,
  },
  {
    address:
      'u1fl5mprj0t9p4jg92hjjy8q5myvwc60c9wv0xachauqpn3c3k4xwzlaueafq27dcg7tzzzaz5jl8tyj93wgs983y0jq0qfhzu6n4r8rakpv5f4gg2lrw4z6pyqqcrcqx04d38yunc6je',
    payable: false,
  },
  {
    address:
      'u1qxqf8ctkxlsdh7xdcgkdtyw4mku7dxma8tsz45xd6ttgs322gdk7kazg3sdn52z7na3tzcrzf7lt3xrdtfp9d4pccderalchvvxk8hghduxrky5guzqlw65fmgp6x7aj4k8v5jkgwuw',
    payable: false,
  },
  {
    address:
      'u1pg2aaph7jp8rpf6yhsza25722sg5fcn3vaca6ze27hqjw7jvvhhuxkpcg0ge9xh6drsgdkda8qjq5chpehkcpxf87rnjryjqwymdheptpvnljqqrjqzjwkc2ma6hcq666kgwfytxwac8eyex6ndgr6ezte66706e3vaqrd25dzvzkc69kw0jgywtd0cmq52q5lkw6uh7hyvzjse8ksx',
    payable: true,
  },
  {
    address:
      'u19mzuf4l37ny393m59v4mxx4t3uyxkh7qpqjdfvlfk9f504cv9w4fpl7cql0kqvssz8jay8mgl8lnrtvg6yzh9pranjj963acc3h2z2qt7007du0lsmdf862dyy40c3wmt0kq35k5z836tfljgzsqtdsccchayfjpygqzkx24l77ga3ngfgskqddyepz8we7ny4ggmt7q48cgvgu57mz',
    payable: true,
  },
  {
    address:
      'u1mtxw5nras5glkxz093282sv3n2h8qs7cpxcmmaxj96vtzjzl6rmdaxs4e9es7mxwmd0h3k5wz3ce4ll5g4jz2pn9su4pufq74pxhp4t235n6j7aed3hh8ss7pf3sekf7apsf6vtg84ue5zcq2k9q3xv5yth3q50fu4czdm8sn8q4de3m5k76g2vwwyjsf50hqfxgmwxqxu0rsy22ktw',
    payable: true,
  },
  {
    address:
      'u1ay3aawlldjrmxqnjf5medr5ma6p3acnet464ht8lmwplq5cd3ugytcmlf96rrmtgwldc75x94qn4n8pgen36y8tywlq6yjk7lkf3fa8wzjrav8z2xpxqnrnmjxh8tmz6jhfh425t7f3vy6p4pd3zmqayq49efl2c4xydc0gszg660q9p',
    payable: true,
  },
  {
    address:
      'u19a4vmx7ysmtavmnaz4d2dgl9pyshexw35rl5ezg5dkkxktg08p42lng7kf9hqtn2fhr63qzyhe8gtnvgtfl9yvne46x6zfzwgedx7c0chnrxty0k5r5qqph8k02zs8e3keul9vj8myju7rvqgjaysa9kt0fucxpzuky6kf0pjgy0a6hx',
    payable: true,
  },
  {
    address:
      'u13p2teem3xlvy4kwlke24hng5el2z6mn4ftj8xarwn8fy7dqt0flgcfpaxe6sk5cwawwh4tynzu7z2uschaf8tfa3tp2xgt8g4kx5lahhglcjm26jnvw7am6ld33708g0kv35pq83eg6gj82a0aau80enrhywpgr4v4m4vve7tg8vd4hz',
    payable: true,
  },
  {
    address:
      'u1snf9yr883aj2hm8pksp9aymnqdwzy42rpzuffevj35hhxeckays5pcpeq7vy2mtgzlcuc4mnh9443qnuyje0yx6h59angywka4v2ap6kchh2j96ezf9w0c0auyz3wwts2lx5gmk2sk9',
    payable: true,
  },
  {
    address:
      'u1szwcx2zdxalyp7cfqwrptv95rnpyajejs6jmwacz4cgm2g3vzdxl5perhpg3nyhnuplvptdr4g63gupdfj5zal9v35s3e6adqsckv68hyrclan3gxaj6mz8aejzsnhqjyn32jcpnpra',
    payable: true,
  },
  {
    address:
      'u1glq6lzrxc7n7r4c922qht20zmpxyl0asfuldrjcaddagfspxpc3040fdfwdf5crw4j6j6wkx4r038s0w24w7enpyfmmdfu9t9p2amxazgvasms8l03l3j5yhrrfqy6xzue5uggef4p8',
    payable: true,
  },
  {
    address:
      'u1tqhg04ppjt6vlf2uvkygt07sqzgpclxdpn7j7ydkcr0e8ym68wn592z7uqudktrwn4u3q57flp8hw3d0wd9t0rm0e6m8eys27evfawh6zhha6eulzj86uz89swu7gtk0vcknd3dauhc96twhx20xxsp93dxahqlt7z5p04ldgy2y2lp0',
    payable: true,
  },
  {
    address:
      'u1zm98xj3ncc79sx8jxhcscptxav0p4wam8mlkf4lp69rhramz7v6fsndwxcd4qtmzkefwcwn5rgd8uztvdrvfqv32jk3xx6wlt7gae9fhs7xh48d3kn9fe92xtcff8hu0zgegmgr95qtxayjylfdct96eg2f2r06drf6sj800mcsns3n0',
    payable: true,
  },
  {
    address:
      'u1hfgf2s4pghqteculnmq2rcnvyesml74zqfp5yfhxhwewx62q75qhgmwreg5qht7c5vu3fxefunjrarrfhmcuw2z4ndx0qx7u74gkw2n7v0ypvd4mxgzlenvs7lkurdj09zuhz6pmtuzs4m42sx92axuuru4dmgu46a920x5kuye6gxvs',
    payable: true,
  },
  {
    address:
      'u17cfcut587e3kszg8vud0z5a8lj9gyypyvtt5xn4hfc4p3kv4e0jfr2pzzxhywlkhsjldtmkvupwr7mkjvruz8gnxk7a64x777p4l3u7vpm6zsdsx88ef90x5q5sqx57fq8vtj5vk3hx',
    payable: true,
  },
  {
    address:
      'u1z6qgxh0wyw0ptgwwgsr5uv05n3xm3z8yrdr06k7q6fj9ypyjcj2hxwfmktv4a7ejaqphcgkddhsvrs93skzl3frm8e48at6huayg7k67e3c50ykpdnhva2jfh5dfcvy6nvttqwgz5a7',
    payable: true,
  },
  {
    address:
      'u1g6jcyfwqd9yx8pdg4yvf0nsr5j7k5gmx83shh8v0v3w256umheen026x66f4608w2vydyasphgp80j9avq9h56dx73gg2559l5lj707v4458a0ucyhfxcjcccfx9z9upmcf3c6hg9k8',
    payable: true,
  },
  {
    address:
      'u1en8ysypun4gdkdnu8zqqg6k73ankr9ffwfzg08wtzg9z939w0wupewemfrc8a630e8gc4uqucym0l4v44fszy3et4veyypt3jsyp0whfpfsn2lw30kj8nepe6wvvasf00wklh85u9v8glqndupmamk9z2ja9sanf70pp4yxvkt3dmyzxa0kkhv2c9pxmkghrxqk0590azvya3nzrtevj449nu3laskrhf7c7nj9cyw7ty38mccg4znrr876guu6pzndx7ngwzhmlsn8d89saf5araaacrhr9958xr6z23mj4qtzzn98whdpu8u7n8fhf5d2vypljda62q73du44sf0e0kxmq3gvgkta0qqgq9w6r403gc5jz2any02etmwlttkv84hgh95czhdf2jugk3u36ke0kchcthg240',
    payable: false,
  },
  {
    address:
      'u1a7gz63aey4tnj4klwauth00vnkmltwafwzk9nld2ys7yz3yjzjcdp47crc37zc4g9aq4athg9zh8r792e44kd6g2f4drhsl5ph4ja8pe4gcc9yjyf3rn7pej808hcy6xh0x6y8khmzljehjlwqq4h2czp35vu3l7aa7rpw5vcng9gswwlaqn5ptes592wejx7f49rxsvmzeqjekjtyfevehanvyksa8gtkpk75yrqnam26hzuxrtm6agaluy4hv0ha4sg6h22394m0x5th6r8uj7svzlklaja852vv9ud5gznu2sqyrsqveqjmfk9rcs59sprjj8nrt2nke862xlhvjq9y9zswen27eqj5slg52q2zch59uzwaeat8jw6z6092uu8yqqnnj7h0yguhypgd8y2wu9ftgg38ym3',
    payable: false,
  },
  {
    address:
      'u1ln90fvpdtyjapnsqpa2xjsarmhu3k2qvdr6uc6upurnuvzh382jzmfyw40yu8avd2lj7arvq57n0qmryy0flp7tm0fw05h366587mzzwwrls85da6l2sr7tuazmv5s02avxaxrl4j7pau0u9xyp470y9hkca5m9g4735208w6957p82lxajzq4l2pqkam86y6jfx8cd8ecw2e05qnh0qq95dr09sgz9hqmflzac7hsxj47yvjd69ej06ewdg97wsu2x9wg3ahfh6s4nvk65elwcu5wl092ta38028p4lc2d6l7ea63s6uh4ek0ry9lg50acxuw2sdv02jh90tzh783d59gneu8ue3wqefjmtndyquwq9kkxaedhtqh2yyjew93ua38vp8uchug0q7kg7qvp4l65t9yqaz2w2p',
    payable: false,
  },
  {
    address:
      'u1sem2gcey0emntrvxyjv8hyhq0w5fr4sxaj3cppgrfqgg6laydh8m78gy2cw2p54zzak3alnnsx4xjuhazpkrfcd90wl0c7ldj6y095hh5j6j2evry9vg5jqp4dyqpwqeryu7pes4sxyyyqwn6egs5daxk4473v9xpgzrwv5n0tvs93nlj4xpphq4vs2w8um9ph7zkte08t7fa509mnrt9apuhr22xq34mp2svjnq6rvfn0hg6lkehxtlj39vgjxjlkjfhx8rw2f02ckq8k5szcxsnhkgr2cqlmf2udl2gqdqr5t6',
    payable: false,
  },
  {
    address:
      'u10j2s9sy4dmuakf57z58jc5t8yuswega82jpd2hk3q62l6fsphwyjxvmvfwy8skvvvea6dnkl8l9zpjf3m27qsav9y9nlj59hagmjf5xh0xxyqr8lymnmtjn6gzgrn04dr5s0k9k9wuxc2udzjh4llv47zm6jn6ff0j65s54h3m6p0n9ajswrqzpvy8eh4d5pvypyc6rp5m07uwmjp4sr0upca5hl7gr4pxg45m7vlnx5r7va4n6mfyr98twvjrhcyalwhddelnnjrkhcj0wcp5eyas2c2kcadrxyzw28vvv47q74',
    payable: false,
  },
  {
    address:
      'u1mtnedjgkz5ln6zzs7nrcyt8mertjundexqdxx52n2x4ww3v52s0akf3qy6sqlze3nexcjsxtcajglxcdwg47dsrrva6g5t4nf8u3sjchhkmsqghelysrn0cl52c2m8uuv3nyfdv258jjqnvd4lgqtugc8aqvpmt05c49qv2yqlhxvnq9phdamm4xv89cc7tzvzgmwltxxdsvme44dgzt8prkcwcsma8cdr76m8n0xwj02tpr9086a237xakkdf8fumsj8u4r6qlf0d59x0mw83ar36vrcr94zsherapa0566vd22',
    payable: false,
  },
  {
    address:
      'u1n9znrl4zyuvds24rcapzglzapqdlax4r8rgkvek0y0xlzfjfvn7zexelrafkchea24w030cr9jqsel7t8lvveaq7m7w4z0khmrlzc6748w9ldlccy02scd5xngtcv2yy4ctnyu9zn5m',
    payable: true,
  },
  {
    address:
      'u19f2knszheph2dt8lrnwqeeq9krnw39pgz8syqv028ghtg7kjz6xvu23suv5hmdmj7e6fjuu6060y34fdw8ccjlp8gsqp0usyhrgw3reqfveet7hh2pqcjafysqqv2l3felj7sl7a7ym',
    payable: true,
  },
  {
    address:
      'u160suxvjkgt22zcp7f9xw5f0axdu7rxdt5ktyexpn4cq70w4at2f74390mns7uksfenrdmcjjzqalyfky6tq05jv8mnamrkyxn9dcxe35z4x6m35cczmjcj55g0fc6a2thz03sjfywxa',
    payable: true,
  },
  {
    address:
      'u1ddnjsdcpm36r6aq79n3s68shjweksnmwtdltrh046s8m6xcws9ygyawalxx8n6hg6vegk0wh8zjnafxgh6msppjsljvyt0ynece3lvm0',
    payable: true,
  },
  {
    address:
      'u1nztelxna9h7w0vtpd2xjhxt4lpu8s9cmdl8n8vcr7actf2ny45nd07cy8cyuhuvw3axcp545y0ktq9cezuzx84jyhex8dk4tdvwhu4dl',
    payable: true,
  },
  {
    address:
      'u1trxzh330wl8wkh92uwv508z0qfx270ruuar8fxeng7arry5d73q9ve6gfud36s9nc4qj3uvn082l9srrfayjhnf20mmunywtvqzgc90c',
    payable: true,
  },
  {
    address:
      'u1xdrenc94696j8clxa2xnkdg8xd5t3y8s24urctyxu87vggv0u46qr4lkpnh7gqqdev9wwugt6xkv8c8du8ufhfl8nfjnzusf6cw20wpm85hlshmnmj2lkyhka9rua7qw7kr0xeajk7y2rlsuwl6z6l5l3wq3v6rrqt9e8zy7sc7pww45jznrj4xy6h9rp4kjy5xtl5upr30u4cyk58kv3t80k3p8w97k3e345h7avmjylxakx6sgyk5ss8th5kqay50ewav62eeep7tghzejaflsdstpwz55haex398jqpq27007me2',
    payable: false,
  },
  {
    address:
      'u1y647tzm2ms4stj8skfswfljmvatmhwqzjzl2uq5v3a78ys2mls2g9thdap4yfmr9tw6y5h9gnehzhpddyl43enmhd6xv2udcttqmas35l62jt2yar33jwr5eulchzxg3d8upf2raqcx3jup8s3dep6an5n5xh9ngdjfp4hjv8fwfhh34kvglsug57zf0duypq6ugmysw0mnhdg5fz9sndputdc7pdssg6k3ks76wrrnuu5najqxj8xchp5xv5ahfh3f2szrfl5cm6mslq2f69ja9r54plen209xwpdpwsvm6zep4gwl',
    payable: false,
  },
  {
    address:
      'u1m5jvynaxyrtk27mt23q0j4r8uf5dzzhlwf6qd4s7pfdclqnmgkaf82kqrch0p44kd97f9pmwnk6q3rnjnzvlwv2ll289ahzlee4zcnual03ntelg2q2wxlqc6ueav935j4j2rzv2gxcdh6lk67quzxnxt5ay9xh0qjc9575dptfs9luhhr0m9wms2taq2vnrryjdj3ht5cktwathcerl9kw25y89f3hffyr65rnfw0jk2ka7703m8wym0c04u6r0xgagpn7xzfaxttrwgftmztzln6y2qcdglk3u28dgrswywqne28g',
    payable: false,
  },
  {
    address:
      'u1tqx832p4wsfe9pd67ggm3qsmfuvdhqvw2259y7uwug7y0lpeu87fmgpqh3zmamex3fzs0d4ct4hhsg2csj5z0q5f3f7n656ap8e4nlng9c4440rz9s7ekxanfw6g84f7vu82fumtmlz3vstl2a9ufa0970k4knsz2wpsjt2xycqeay76pt4fx3ak9y7mps2q6qe2n2h7wkakxr7xu6vd36zhhzgln7ttmrzc0f9ye3jmyu2pp8l8rect87lfxj2fgckcwz3svdx70a947fz04kgu7e907enzrk676zdkdmuyw2kyrclkmj62kmyy2rjetpus7knmxfuu7z0m63uwfhdynhuu3yrjqu5y089v8zwnh60mw5ngc0kszdjmc339fk9mjn396m5ekv7h7td7fa0u9097xph3y5vth9af4sw6ykxdms84wr544mxxqtmgj027d9e8rnlrazge0kwyydyhder3chwhmaqjk9skuxgxzternw4xx962qed',
    payable: false,
  },
  {
    address:
      'u1adph5ua2pv8ghr7utshst0fm0ad7tj32y09t2nhxn2ccwm6hengck3w2vy34tvhqay7rlw8vcfh63f85lh7lz63l0c5vja49tu8vcxvx30re085n8jt5hcqh4g4ec77czl4c8nspqps2ac2g5kxhl4j5g6mz3vsvxrg74e8p9s8hhqu8u3gldhxvrxg2htykqc7ceh930f3edxsg49nctv2e36cne6qpkvxzfymh2el2eguw6kg7zvdu620rgk4cwyvt9hz7zpjk9wskjdpk6p3cpyx3yuf5lk46nx2fyqjca3vtz8d9df3tpmg74d90uv7pp09apfa5ep374clznmh2ne5suxtzk22cp7mvu9gtswpvx9wfst63s73yjwqu9cjenwntdsep0uqz2hgnh4xpq0rlllwgv8z70ke6z5zkwnjmlrzt6nsvhac4zz245rp3rkj9lmj8tvpfmd0zawy08dv3hqxxf8cr06x90amtgkh2ura0yyfwucu',
    payable: false,
  },
  {
    address:
      'u12acx92vw49jek4lwwnjtzm0cssn2wxfneu7ryj4amd8kvnhahdrq0htsnrwhqvl92yg92yut5jvgygk0rqfs4lgthtycsewc4t57jyjn9p2g6ffxek9rdg48xe5kr37hxxh86zxh2ef0u2lu22n25xaf3a45as6mtxxlqe37r75mndzu9z2fe4h77m35c5mrzf4uqru3fjs39ednvw9ay8nf9r8g9jx8rgj50mj098exdyq803hmqsek3dwlnz4g5whc88mkvvjnfmjldjs9hm8rx89ctn5wxcc2e05rcz7m955zc7trfm07gr7ankf96jxwwfcqppmdefj8gc6508gep8ndrml34rdpk9tpvwzgdcv7lk2d70uh5jqacrpk6zsety33qcc554r3cls4ajktg03d9fye6exk8gnve562yadzsfmfh9d7v6ctl5ufm9ewpr6se25c47huk4fh2hakkwerkdd2yy3093snsgree5lt6smejfvse8v',
    payable: false,
  },
  {
    address:
      'u1uehkuaq6rpfgt4ed5zpvhczg9apgpmyk5eq9qg23j8w7jxkhdnqzacte6gu8zgzfzgxy48ryzus3wnkhfxrxmlhs34xde3f34uxcnv3y6dsgj288vu56xs9f6ghvqsgkhuwtz4kkfxj8pa27v5p3ttlst340zvwx9nj6s0zw8p3wwk3zh37dwc7znqz52gj2fpaapzxzyagah0aeyxwa9fxxvyyj6w989v96ymsgf7s8s6ej9346p60fcjzzynvf9rmxevumdvt8l9mvhdfz4u5j4h7e0zjr2sde7fu7z9s02447qg6qzllm22egnx6ej6qczkkk2ygvpy08un9ggp853sddp6vskrlar6sygxec5f6c2t2eu9zmc728esy4sj9z853gxuplr6hw7lpcwzk20d85vuflnhlfv8nr3020r0v9z83ryudsyjv66rttxq2cscqlrdxakrmpjptzcf',
    payable: false,
  },
  {
    address:
      'u1m76hh3wch9vwctg92h0jjt8zu6dry4zl97q9q94huutng5sxyhlzgfj64jqnvla2vqrqe0ndt67td2kejv6zlcw9zeurexxs67l7y67p7mww2j2uvfsp6uynct2apcr0m9xrmswtktmgs3x2glvndrqazy0gyrp30j328h4m5gkju9rl3pfrtjn9tm8v0rzr6t8gkklqfxgwk976dvv4kh7hl5utp9gjryu8wwu80h733ss5cjwpeewdgd3l8h46c0c7hxz4c6daws3vurq2fj9h0hpjnycup9tu8nfahvqjxewyhyuzynnjxa7jrvw2ekdytqs7sn02gqx4vxtkjzfrcy67lkmr6p5kalj0g8apazeyzqw3ywppy9482wj8k4tm06573nr3h78ecq9n260g7c0hm5jm3ffa4g2vk0edpdsnemksdegxgt9s7h8v8pjmcp23rnahmzf8pxdtdt',
    payable: false,
  },
  {
    address:
      'u1c2tpmmdl49pdcfntc2e2gjaxmj2a0ackydlj9aeuqlet4erjdn2edwvtx6vd8nrkxjnvgckn4j3nx48p2gep5x23akrl2cv7u2un4vmjed9hav39taqgzyp602m3tpcv3uzdsjdyl8wxrjycx5aus8ypq2xja8yw0cf045n0zvwt3ajtgs2xyzjl6cq2245avkm26qjv72ta65h04etlp4ntdq87eu9efjx5v6gjsfvwrdt99m4lpu9j52t0h8yvpnzukuzdt89e3pg9cmderzh7tnahmw0rfyc37aqmd6dh24fnxmxagsj4mtz8jv3c3ch20xu4k6whwfsaf2sra4ktgdej9p6kqz05ae3vl3f93xsfx05xpaf884h56epcetx627jttgx2499vc0uzxl83hcdt92z4hy5la40ervrpha4kn3kxxwrngdj76u6mrfcmt4737czn08vd60k5gj',
    payable: false,
  },
  {
    address:
      'u1dqavtnjvu42hlsjw6sc2mxajqlyt03zg8l4luykz9fnchunq74nqxhfp58h5n5xfpyqhheax8thta8lfkjgp8wqwsavc0g4mgu4du02c',
    payable: true,
  },
  {
    address:
      'u1q8g29qhrktunc24lud3fgk007u7ya8q5g8vy9awadxtl7wu5vjllr4mmdfwk0zdh8zqxgl93sthzumeanzzkdqmqdft6ryhwtvqyqt3e',
    payable: true,
  },
  {
    address:
      'u13j3q8q8f9hx2nx0w9l52dqksy4png7fgm0lqjh8ahn9enyvz5z9xnwzdcdjmpf756s2y88rnyr9px4f4k9w03sl6fr4vwsqcvg8ggfjx',
    payable: true,
  },
  {
    address:
      'u1ukslldhknrzmvpdmn03u03edgfy976w3muurfs9asvh3n9uh9h6sgle6m7yjgf3wafxtvke08u735v4nd3kjqnyulw7cvxh6ke357knyjudgqtes6kcw7y28e6kewr03pjah5mh26na',
    payable: true,
  },
  {
    address:
      'u1a0dnfvgdp4khm5yk79ltkkvp8jjmjykjy38cdue8ktl8askwenl4lzfyu0p7end0guyu6up57wylzns0tpr99wz5z8edh5u0m4yzuusysr3d2xczwkp82atq3vfw45u2yvtau852lnw',
    payable: true,
  },
  {
    address:
      'u1a84vn0qes8q3jhk7zxs2whd2p922far8kztqdapergs5ej8rarn53v5ddnd6t7e3l5efhaefrhkptatnzq565nrpvf7kn2787gdvervmk08azp4qgehaew2zplkxkkyu36l3v7drg2v',
    payable: true,
  },
  {
    address:
      'u187vrwl4ampyxd5m6aj38n4ndkmj8v6gs97hkt23aps3sn5k89a0gk2smluexgdprcrtm56ezc5c7tjwlrnnl79tjtrxmqd42c5mpyz7g',
    payable: false,
  },
  {
    address:
      'u1xd83nhheggwe78x3lvcygdl8cmwz3gfxnr02sytkxvfpwdep9dzl7vte48zhkx39s705yqp20rw4l835fhg3ylkde44l7glt3cyps5wk',
    payable: false,
  },
  {
    address:
      'u1w7x9ttwvk30grems6ae3rhgs6xytrrueaklyc5t509fpux7043fzla70jehhxyn4mg9d3ym095s3wghl9trvvdmu56yn74ajqy38ufjg',
    payable: false,
  },
  {
    address:
      'u1smpx6drvevct3dyrer7esjlct99lf4nxdeltdetyxjdrmtqag7q7mkrd8rxlvj9e5vy0qy24fhvvvrj7agfdgxapefxe72xl8vuu9ds5yfq0p86r3y0jw4suurzjz5s6lzrxkfft4am',
    payable: true,
  },
  {
    address:
      'u1ymxkv9nks7tuzjt265fg8vctdq5nxqw4l0q2xj2ya5dkt660rrzkg032v5duhgeqae6cnh9tzxry4dspv8yvtq5lem9gujysaz64034mavd8p0ejqhnvp2jg34nt24y2c2whclxxk94',
    payable: true,
  },
  {
    address:
      'u14j8rtl62a70skh0nhzv7tasxsa69axm0vlac37ye3mcgfpjk6k9ury7hlmet0grhvhedtfj27xmsygp06pcm932f8sc33u5uwps57d89667kyhwmj8pucp5r8cel2lhuaxmx5ftm2nt',
    payable: true,
  },
  {
    address:
      'u1xjkw3lwwf9crx8cz050gdwfejufzhcusc37ged99w8fyj7tyx3e7hgmauyuv538dak2sepq6wjv4tyyjnhcef02dr682y5dsuzuftsx83lrvfc6dxd0kk260m4p3c9ka96vf3z9u6axvsj47mfd6kszy39e5gma28yg88yp92kxjt8ah0x329j4gxjdfyn0n2wp3urwrxxz6z0ynx82',
    payable: true,
  },
  {
    address:
      'u1p4c4u3uz2vtkedv78d4phjav86exankz0x9wmrmz8q4mxqaf43gwd0qt486jk5jvpvyccc6lyy2vaq3ht8ngnw4vusryxd9erhhl2uy5x6x4huyfdymwxj7dkyyeut8ld36kxwu3v5wjg7jwp9kr8ul7u3xdakfunvmwq0rkv6y4k0ngm2n24x763uurfmrr685welsefyys2xwp8ug',
    payable: true,
  },
  {
    address:
      'u1ap7zakdnuefrgdglr334cw62hnqjkhr65t7tketyym0amkhdvyedpucuyxwu9z2te5vp0jf75jgsm36d7r09h6z3qe5rkgd8y28er6fz8z5rckspevxnx4y9wfk49njpcujh5gle7mfan90m9tt9a2gltyh8hx27cwt7h6u8ndmzhtk8qrq8hjytnakjqm0n658llh4z0277cyl2rcu',
    payable: true,
  },
  {
    address:
      'u1udmzarqn6y9026whk083lm5vs8pv282egeln6xg0n2a3w4klkpn6208h68ntuus7gp54d937u4f724v2xgdx6qeu74j45vxfn822xty2yyx6u0ecakj8r9uu3r2jqafj64w7updkhtq',
    payable: true,
  },
  {
    address:
      'u1fyvdgdehrx3gvjx5f2ez2lkcm0lcrfxg8hksdmg3g8zujfz8xk2kyhu4dafs99y96sq2t5c3d3zsxhhnlfmj6trmttg5awtwczz8g8xjr7u30hxc4nkyfyefyl4xt3dxdjevsnrkqdg',
    payable: true,
  },
  {
    address:
      'u1kfzux4hf9favh8jmssqa2h04k87advldqz5ze7a8t4un3nkegklhz3ewzk6lmqg0uy7matdway9vn2q8q9rxp0fjwuewpcjtwrwavxjdsfxdvsk5nkx4q35atp0tfepfdsapqkk4en5',
    payable: true,
  },
  {
    address:
      'u1hrwrtyl3m8m2c6vkhu8wng43j5yvwweg37n2qstsqwc9dfw4vhs69m09064522758p44pfz42gu6hydjxua0wt0ge907sgrxkc9mft4gyfjevkhsyl4d8lnzgyd90arhx4t6v20zlfz',
    payable: false,
  },
  {
    address:
      'u1rf4n5f682jspygln8r5pjwh6fmta7xz6n9x868f5wgc9prxsqkrh8jkpmn7wfnag56ml7czw68dv96299ft6s98p05u4jvdx3elyr83jqnzr603vw8yarptpg5pj73zlea0sksuje3r',
    payable: false,
  },
  {
    address:
      'u1l6exm3zmfsr74sqvlwgc0zf7mydwf6z5r79amka84kfwzwef3wxs0yupl2lwhws85vdmqet3rtz795gpnm4h0jjfv4hanwqta0ezlxqe4p578a4aq09s93xhhtf3xhtrlh575qrsf5g',
    payable: false,
  },
]

/** `[raw, jumbled]` hex pairs up to 193 bytes; the longer rows add no other branch. */
export const f4JumbleVectors: [string, string][] = [
  [
    '5d7a8f739a2d9e945b0ce152a8049e294c4d6e66b164939daffa2ef6ee6921481cdd86b3cc4318d9614fc820905d042b',
    '0304d029141b995da5387c125970673504d6c764d91ea6c082123770c7139ccd88ee27368cd0c0921a0444c8e5858d22',
  ],
  [
    'b1ef9ca3f24988c7b3534201cfb1cd8dbf69b8250c18ef41294ca97993db546c1fe01f7e9c8e36d6a5e29d4e30a73594bf5098421c69378af1e40f64e125946f',
    '5271fa3321f3adbcfb075196883d542b438ec6339176537daf859841fe6a56222bff76d1662b5509a9e1079e446eeedd2e683c31aae3ee1851d7954328526be1',
  ],
  [
    '62c2fa7b2fecbcb64b6968912a6381ce3dc166d56a1d62f5a8d7551db5fd9313e8c7203d996af7d477083756d59af80d06a745f44ab023752cb5b406ed8985e18130ab33362697b0e4e4c763ccb8f676495c222f7fba1e31defa3d5a57efc2e1e9b01a035587d5fb1a38e01d94903d3c3e0ad3360c1d3710acd20b183e31d49f',
    '498cf1b1ba6f4577effe64151d67469adc30acc325e326207e7d78487085b4162669f82f02f9774c0cc26ae6e1a76f1e266c6a9a8a2f4ffe8d2d676b1ed71cc47195a3f19208998f7d8cdfc0b74d2a96364d733a62b4273c77d9828aa1fa061588a7c4c88dd3d3dde02239557acfaad35c55854f4541e1a1b3bc8c17076e7316',
  ],
  [
    '25c9a138f49b1a537edcf04be34a9851a7af9db6990ed83dd64af3597c04323ea51b0052ad8084a8b9da948d320dadd64f5431e61ddf658d24ae67c22c8d1309131fc00fe7f235734276d38d47f1e191e00c7a1d48af046827591e9733a97fa6b679f3dc601d008285edcbdae69ce8fc1be4aac00ff2711ebd931de518856878f7',
    '7508a3a146714f229db91b543e240633ed57853f6451c9db6d64c6e86af1b88b28704f608582c53c51ce7d5b8548827a971d2b98d41b7f6258655902440cd66ee11e84dbfac7d2a43696fd0468810a3d9637c3fa58e7d2d341ef250fa09b9fb71a78a41d389370138a55ea58fcde779d714a04e0d30e61dc2d8be0da61cd684509',
  ],
  [
    '3476f21a482ec9378365c8f7393c94e2885315eb4671098b79535e790fe53e29fef2b3766697ac32b4f473f468a008e72389fc03880d780cb07fcfaabe3f1a84b27db59a4a153d882d2b2103596555ed9494c6ac893c49723833ec8926c1039586a7afcf4a0d9c731e985d99589c8bb838e8aaf745533ed9e8ae3a1cd074a51a20da8aba18d1dbebbc862ded42435e92476930d069896cff30eb414f727b89e001afa2fb8dc3436d75a4a6f26572504b192232ecb9f0c02411e52596bc5e9045',
    '5139912fe8b95492c12731995a0f4478dbeb81ec36653a21bc80d673f3c6a0feef70b6c566f9d34bb726c098648382d105afb19b2b8486b73cbd47a17a0d2d1fd593b14bb9826c5d114b850c6f0cf3083a6f61e38e42713a37ef7997ebd2b376c8a410d797b3932e5a6e39e726b2894ce79604b4ae3c00acaea3be2c1dfe697fa644755102cf9ad78794d0594585494fe38ab56fa6ef3271a68a33481015adf3944c115311421a7dc3ce73ef2abf47e18a6aca7f9dd25a85ce8dbd6f1ad89c8d',
  ],
  [
    '7e745939ffedbd12863ce71a02af117d417adb3d15cc54dcb1fce467500c6b8fb86b12b56da9c382857deecc40a98d5f2935395ee4762dd21afdbb5d47fa9a6dd984d567db2857b927b7fae2db587105415d4642789d38f50b8dbcc129cab3d17d19f3355bcf73cecb8cb8a5da01307152f13936a270572670dc82d39026c6cb4cd4b0f7f5aa2a4f5a5341ec5dd715406f2fdd2afa733f5f641c8c21862a1bafce2609d9eecfa158cfb5cd79f88008e315dc7d8388e76c1782fd2795d18a763624',
    '1a52585e652da6ea46994954905cb79f55fca58171a4d7f773a57d23ed9ddec0c745ef0f4588fa7b2b68d69cdd25e5eb0e08c20523a3957171f1730ab0636faee75da2dc9e89562f0653d4e9422179286ae8305f01371f47ab16eed692c3895ce2fd655e4b19651c35d83c81894f687055b581114440646508e39a49b0d5a99004560af7367cc2738344d4e797a995ed66df72228e3d3746674337104700144c73b6db27d238c9e1770662feb0957d5028b5086f3839aacf275022dd7e7e983b6d',
  ],
]
